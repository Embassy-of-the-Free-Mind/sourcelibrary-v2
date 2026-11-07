#!/usr/bin/env node
// PRIOR ART: scripts/eval/estimator/chain/volumes-by-draft.mjs — the census of pages per book x draft bucket that the
// router's pages_waiting come from (its bucket $switch is copied here). It does not split by script type, and re-running
// it over 8M pages to add one key is hours; this estimates each cell's print / manuscript / unknown share from a sample
// of its books (pages-weighted), and counts small frames in full.
/**
 * Pages waiting per router cell x script type (#7263, Derek inbox 2026-10-28 11:54Z). Read-only.
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/router-next-7263/waiting-split.mjs \
 *     --census=<volumes-by-draft.jsonl.gz> --out=<file.json> [--books=120]
 * Per cell frame (language + the census draft bucket, or a translation model): candidate books from the census
 * (languages it holds) else from `books` (visible, pages_count > 0, pages_ocr > 0). <= --books candidates: every book is
 * counted (exact). More: --books drawn with replacement, probability ∝ the book's frame pages (census) or pages_count,
 * seeded, and the share is the mean of the drawn books' shares (unbiased under that draw); 90% interval by a bootstrap
 * over the drawn books. Per page: script-type.mjs's order (tag where the field is missing, the tag on a conflict, else
 * the field, else the book's majority of pages.script_type, else unknown; mixed = print).
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { bookHand } from '../../lib/ocr-trust-gate.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const NB = Number(arg('books') || 120);
const h = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const unit = (s) => (parseInt(h(s).slice(0, 13), 16) + 0.5) / 2 ** 52;
const DRAFT = { lite: /flash-lite/, paddle: /paddle/i, yigdzin: /yigdzin/i, flash3: /^gemini-3-flash/ };
const BEFORE = { flash3: [/flash-lite/, /paddle/i, /yigdzin/i] };  // the census $switch: an earlier branch wins
// frame per router cell: language, draft bucket (census) or translation model, zh options
const F = (language, draft, x = {}) => ({ language, draft, ...x });
const FRAMES = {
  'latin-lite': F('Latin', 'lite'), 'latin-flash3': F('Latin', 'flash3'), 'german-lite': F('German', 'lite'), 'german-flash3': F('German', 'flash3'),
  'german-tr-flash3': F('German', null, { tr: /^gemini-3-flash/ }), 'german-tr-lite': F('German', null, { tr: /flash-lite/ }),
  'french-lite': F('French', 'lite'), 'greek-flash3': F('Greek', 'flash3'), 'tibetan-yigdzin': F('Tibetan', 'yigdzin'),
  'zh-paddle-dice-lt090': F('Chinese', 'paddle', { guarded: false, dice: 'lt0.90' }), 'chinese-flash3': F('Chinese', 'flash3'),
  'zh-frame-6871': F('Chinese', 'paddle', { guarded: true }), 'hebrew-flash3': F('Hebrew', 'flash3'), 'arabic-flash3': F('Arabic', 'flash3'),
  'zh-siku-tr': F('Chinese', 'paddle', { note: 'proxy: the Paddle (Siku) pages; the cell is the 10-12 Siku retranslation census' }),
  'zh-lite': F('Chinese', 'lite'), 'greek-lite': F('Greek', 'lite'), 'sanskrit-lite': F('Sanskrit', 'lite'), 'arabic-lite': F('Arabic', 'lite'),
  'italian-lite': F('Italian', 'lite'), 'spanish-lite': F('Spanish', 'lite'), 'korean-lite': F('Korean', 'lite'), 'russian-lite': F('Russian', 'lite'),
  'portuguese-lite': F('Portuguese', 'lite'), 'danish-lite': F('Danish', 'lite'), 'hindi-lite': F('Hindi', 'lite'), 'middle-english-lite': F('Middle English', 'lite'),
  'mhg-lite': F('Middle High German', 'lite'), 'old-french-lite': F('Old French', 'lite'), 'ottoman-lite': F('Ottoman Turkish', 'lite'),
  'tamil-lite': F('Tamil', 'lite'), 'turkish-lite': F('Turkish', 'lite'),
};
const census = zlib.gunzipSync(fs.readFileSync(arg('census'))).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const censusLangs = new Set(census.map((r) => r.language));
const c = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' }); await c.connect();
const db = c.db('bookstore');
const CLASS = { printed: 'print', mixed: 'print', handwritten: 'manuscript' };
const TAG = /<script>\s*(printed|handwritten|mixed)\s*<\/script>/i;

function inFrame(p, f) {
  if (f.tr) return typeof p.tm === 'string' && f.tr.test(p.tm) && !(f.tr.source === '^gemini-3-flash' && /flash-lite/.test(p.tm));
  if (typeof p.m !== 'string' || !DRAFT[f.draft].test(p.m) || (BEFORE[f.draft] || []).some((rx) => rx.test(p.m))) return false;
  if (f.guarded != null && (p.pl === 'paddle-zh-guarded-2026-10') !== f.guarded) return false;
  if (f.dice === 'lt0.90' && !(typeof p.dice === 'number' && p.dice < 0.9)) return false;
  return true;
}
async function countBook(bookId, f) {
  const ps = await db.collection('pages').aggregate([{ $match: { book_id: bookId } }, { $project: { _id: 0, st: '$script_type', m: '$ocr.model', tm: '$translation.model', pl: '$ocr.pipeline', dice: '$ocr.qa_screen.dice',
    head: { $substrCP: [{ $ifNull: ['$ocr.data', ''] }, 0, 400] } } }], { maxTimeMS: 300000 }).toArray();
  const prof = { handwritten: 0, printed: 0, mixed: 0 };
  for (const p of ps) if (prof[p.st] != null) prof[p.st]++;
  const hand = bookHand(prof);
  const t = { print: 0, manuscript: 0, unknown: 0, conflict: 0, by_book: 0, n: 0 };
  for (const p of ps) {
    if (!inFrame(p, f)) continue;
    t.n++;
    const tag = String(p.head).match(TAG)?.[1]?.toLowerCase(), field = CLASS[p.st] ? p.st : null;
    if (tag && field && CLASS[tag] !== CLASS[field]) t.conflict++;
    const raw = tag || field;
    if (raw) t[CLASS[raw]]++; else if (hand !== 'unknown') { t[hand]++; t.by_book++; } else t.unknown++;
  }
  return t;
}
const out = { generated_by: 'scripts/eval/router-next-7263/waiting-split.mjs', at: new Date().toISOString(), books_per_cell: NB, cells: {} };
for (const [cell, f] of Object.entries(FRAMES)) {
  let cand;
  if (censusLangs.has(f.language)) {
    const by = new Map();
    for (const r of census) {
      if (r.language !== f.language) continue;
      if (f.draft && (r.draft !== f.draft || (f.guarded != null && r.zh_guarded !== f.guarded) || (f.dice && r.dice !== f.dice))) continue;
      by.set(r.book_id, (by.get(r.book_id) || 0) + r.pages);
    }
    cand = [...by].map(([id, w]) => ({ id, w }));
  } else {
    cand = (await db.collection('books').find({ language: f.language, visible: true, pages_count: { $gt: 0 }, pages_ocr: { $gt: 0 } }, { projection: { _id: 0, id: 1, pages_count: 1 } }).toArray()).map((b) => ({ id: b.id, w: b.pages_count }));
  }
  const exact = cand.length <= NB;
  let draw = cand;
  if (!exact) {
    const W = cand.reduce((a, b) => a + b.w, 0); let acc = 0; const cum = cand.map((b) => (acc += b.w) / W);
    draw = Array.from({ length: NB }, (_, i) => cand[cum.findIndex((x) => x >= unit(`ws-${cell}-${i}`))]);
  }
  const per = [], seen = new Map();
  for (const b of draw) { if (!seen.has(b.id)) seen.set(b.id, await countBook(b.id, f)); per.push(seen.get(b.id)); }
  const tot = per.reduce((a, t) => { for (const k of Object.keys(t)) a[k] = (a[k] || 0) + t[k]; return a; }, {});
  let share;
  if (exact) share = Object.fromEntries(['print', 'manuscript', 'unknown'].map((k) => [k, tot.n ? tot[k] / tot.n : null]));
  else {
    const sh = (xs) => Object.fromEntries(['print', 'manuscript', 'unknown'].map((k) => [k, xs.filter((t) => t.n).reduce((a, t) => a + t[k] / t.n, 0) / Math.max(1, xs.filter((t) => t.n).length)]));
    share = sh(per);
    const boots = Array.from({ length: 500 }, (_, j) => sh(per.map((_, i) => per[Math.floor(unit(`bs-${cell}-${j}-${i}`) * per.length)])));
    share.ci90 = Object.fromEntries(['print', 'manuscript', 'unknown'].map((k) => { const v = boots.map((b) => b[k]).sort((a, b) => a - b); return [k, [v[25], v[474]]]; }));
  }
  out.cells[cell] = { frame: { ...f, draft: f.draft, tr: f.tr?.source }, candidates: cand.length, exact, books_counted: seen.size, pages_counted: tot.n, conflict_pages: tot.conflict, by_book_majority_pages: tot.by_book, share };
  console.log(cell, exact ? 'exact' : `sample ${seen.size}/${cand.length}`, tot.n, JSON.stringify(Object.fromEntries(Object.entries(share).filter(([k]) => k !== 'ci90').map(([k, v]) => [k, v == null ? null : +v.toFixed(3)]))));
}
await c.close();
fs.writeFileSync(arg('out'), JSON.stringify(out, null, 1));
