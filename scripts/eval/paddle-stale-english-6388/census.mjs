#!/usr/bin/env node
// PRIOR ART: scripts/eval/paddle-zh-qa-6388/prepare.mjs (the seeded one-page-per-book draw over the Paddle lane's books;
// it judges the Paddle TEXT, not the English the lane left stale) and scripts/eval/ground-truth-5935/lib.mjs (bodyText,
// foldHan — reused so "CER" means Han characters only, margins removed, Kanripo variants folded).
//
// #6388 stale-English measurement, step 1 (census) and step 2 (draw). No model call, no write to pages/books. $0.
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/paddle-stale-english-6388/census.mjs
// Frame: pages with translation_stale.lane = 'paddle-zh-2026-10' (scripts/lib/paddle-zh-lane.mjs LANE) whose English is
// still present. For each, old-vs-new CER = Levenshtein(superseded reading, current Paddle reading) / |Paddle|, both as
// foldHan(bodyText(·)), capped at 1. The superseded reading is the page_revisions row the lane wrote (reason
// reocr_paddle_zh_*, field ocr), latest if several.
// Out: census-summary.json + draw.json (committed); $JOB_SCRATCH/census.jsonl.gz (every page, with texts).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MongoClient } from 'mongodb';
import { bodyText, foldHan, makeRng } from '../ground-truth-5935/lib.mjs';
import { LANE } from '../../lib/paddle-zh-lane.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SCRATCH = process.env.JOB_SCRATCH || '/tmp/english-eval-6388';
const SEED = 6388, N_RANDOM = 60, N_TOP = 20, MIN_HAN = 8;

export function lev(a, b) {
  const x = [...a], y = [...b];
  if (!x.length) return y.length; if (!y.length) return x.length;
  let prev = new Int32Array(y.length + 1), cur = new Int32Array(y.length + 1);
  for (let j = 0; j <= y.length; j++) prev[j] = j;
  for (let i = 1; i <= x.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    [prev, cur] = [cur, prev];
  }
  return prev[y.length];
}
const han = t => foldHan(bodyText(t));
export const oldNewCer = (oldT, newT) => { const o = han(oldT), n = han(newT); return { cer: Math.min(1, lev(o, n) / Math.max(1, [...n].length)), old_han: [...o].length, new_han: [...n].length }; };
const q = (xs, p) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const pages = await db.collection('pages').find(
  { 'translation_stale.reason': 'ocr_rewritten', 'translation_stale.lane': LANE },
  { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, archived_photo: 1, 'ocr.data': 1, 'ocr.source': 1, 'ocr.engine.postprocess': 1, 'ocr.engine.input.image_url': 1, 'translation.data': 1, 'translation.model': 1, 'translation.source': 1, translation_stale: 1 } },
).toArray();
console.log('stale pages (lane)', pages.length);
const revs = new Map();
for (let i = 0; i < pages.length; i += 500) {
  const ids = pages.slice(i, i + 500).map(p => p.id);
  const rows = await db.collection('page_revisions').find({ page_id: { $in: ids }, field: 'ocr', reason: /^reocr_paddle_zh_/ }, { projection: { _id: 0, page_id: 1, data: 1, reason: 1, model: 1, created_at: 1 } }).toArray();
  for (const r of rows) { const p = revs.get(r.page_id); if (!p || r.created_at > p.created_at) revs.set(r.page_id, r); }
}
const books = new Map((await db.collection('books').find({ id: { $in: [...new Set(pages.map(p => p.book_id))] } }, { projection: { _id: 0, id: 1, title: 1 } }).toArray()).map(b => [b.id, b.title]));
await c.close();

const rows = [];
const counts = { stale_pages: pages.length, english_present: 0, not_paddle_now: 0, no_revision: 0, table_or_diagram: 0, under_min_han: 0, eligible: 0 };
for (const p of pages) {
  const en = String(p.translation?.data || '').trim();
  if (!en || /^\s*\[[^\]]*\]\s*$/.test(en)) continue;
  counts.english_present++;
  const pp = p.ocr?.engine?.postprocess || {};
  const rev = revs.get(p.id);
  const r = { page_id: p.id, book_id: p.book_id, title: String(books.get(p.book_id) || '').slice(0, 80), page_number: p.page_number, image: p.ocr?.engine?.input?.image_url || p.archived_photo, tables: pp.tables_flattened || 0, imgs: pp.img_dropped || 0, rev_model: rev?.model || null, rev_reason: rev?.reason || null, tr_model: p.translation?.model || null, old: rev?.data ?? null, paddle: p.ocr?.data || '', english: en }; // image-pick-ok: the image the Paddle lane itself read (ocr.engine.input.image_url), archived_photo only as fallback
  if (p.ocr?.source !== 'paddle') { counts.not_paddle_now++; r.excluded = 'not_paddle_now'; }
  else if (!rev) { counts.no_revision++; r.excluded = 'no_revision'; }
  Object.assign(r, rev ? oldNewCer(rev.data, r.paddle) : {});
  if (!r.excluded && (r.tables > 0 || r.imgs > 0)) { counts.table_or_diagram++; r.excluded = 'table_or_diagram'; }
  if (!r.excluded && r.new_han < MIN_HAN) { counts.under_min_han++; r.excluded = 'under_min_han'; }
  if (!r.excluded) counts.eligible++;
  rows.push(r);
}
fs.mkdirSync(SCRATCH, { recursive: true });
fs.writeFileSync(path.join(SCRATCH, 'census.jsonl.gz'), zlib.gzipSync(rows.map(r => JSON.stringify(r)).join('\n') + '\n'));

const elig = rows.filter(r => !r.excluded);
const cers = elig.map(r => r.cer).sort((a, b) => a - b);
const allC = rows.filter(r => r.cer != null).map(r => r.cer).sort((a, b) => a - b);
const deciles = xs => Object.fromEntries([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].map(p => [`p${Math.round(p * 100)}`, +q(xs, p >= 1 ? 0.9999 : p).toFixed(4)]));
const top = q(cers, 0.9);
const byBook = new Map(); for (const r of elig) (byBook.get(r.book_id) || byBook.set(r.book_id, []).get(r.book_id)).push(r);
const summary = {
  computed_at: new Date().toISOString(), lane: LANE, counts,
  books: { with_stale_english: new Set(rows.map(r => r.book_id)).size, eligible: byBook.size },
  revision_models: Object.entries(elig.reduce((m, r) => (m[r.rev_model] = (m[r.rev_model] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]),
  translation_models: Object.entries(elig.reduce((m, r) => (m[r.tr_model] = (m[r.tr_model] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]),
  cer_deciles_eligible: deciles(cers), cer_deciles_all_with_revision: deciles(allC), top_decile_threshold: +top.toFixed(4),
  eligible_pages_cer_ge: Object.fromEntries([0.02, 0.05, 0.1, 0.2, 0.3, 0.5].map(t => [t, cers.filter(x => x >= t).length])),
};

// Draw (step 2): one page per book. Random arm: N_RANDOM books by seed 6388, one page each by seed 6388 ^ book index.
// Extremes arm: books not in the random arm that have a page with CER >= the top-decile threshold, N_TOP of them by
// seed 6389, their highest-CER page.
const rng = makeRng(SEED);
const ids = [...byBook.keys()].sort();
for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
const pick = [];
for (const b of ids.slice(0, N_RANDOM)) { const ps = byBook.get(b).sort((x, y) => x.page_number - y.page_number); const r2 = makeRng(SEED ^ ids.indexOf(b)); pick.push({ ...ps[Math.floor(r2() * ps.length)], arm: 'random' }); }
const used = new Set(pick.map(p => p.book_id));
const topBooks = [...byBook.keys()].sort().filter(b => !used.has(b) && byBook.get(b).some(r => r.cer >= top));
const r3 = makeRng(SEED + 1);
for (let i = topBooks.length - 1; i > 0; i--) { const j = Math.floor(r3() * (i + 1)); [topBooks[i], topBooks[j]] = [topBooks[j], topBooks[i]]; }
for (const b of topBooks.slice(0, N_TOP)) pick.push({ ...byBook.get(b).sort((x, y) => y.cer - x.cer)[0], arm: 'top_decile' });
const BINS = [[0, 0.05], [0.05, 0.1], [0.1, 0.2], [0.2, 0.5], [0.5, 1.01]];
export const binOf = x => { const b = BINS.find(([lo, hi]) => x >= lo && x < hi); return `${b[0]}–${b[1] > 1 ? 1 : b[1]}`; };
summary.bins = BINS.map(([lo, hi]) => ({ bin: binOf(lo), eligible_pages: cers.filter(x => x >= lo && x < hi).length }));
const draw = { seed: SEED, drawn_at: summary.computed_at, rule: 'one page per book; 60 books uniformly (seed 6388), one random eligible page each; 20 further books with a page at CER >= the top-decile threshold (seed 6389), their highest-CER page', top_decile_threshold: summary.top_decile_threshold,
  items: pick.map(p => ({ arm: p.arm, book_id: p.book_id, title: p.title, page_id: p.page_id, page_number: p.page_number, cer: +p.cer.toFixed(4), bin: binOf(p.cer), old_han: p.old_han, new_han: p.new_han, rev_model: p.rev_model, tr_model: p.tr_model, image: p.image })) };
fs.writeFileSync(path.join(HERE, 'census-summary.json'), JSON.stringify(summary, null, 1) + '\n');
fs.writeFileSync(path.join(HERE, 'draw.json'), JSON.stringify(draw, null, 1) + '\n');
fs.writeFileSync(path.join(SCRATCH, 'draw-texts.json'), JSON.stringify(pick.map(p => ({ page_id: p.page_id, old: p.old, paddle: p.paddle, english: p.english })), null, 1));
console.log(JSON.stringify(summary, null, 1));
console.log('drawn', pick.length, pick.reduce((m, p) => (m[p.arm] = (m[p.arm] || 0) + 1, m), {}));
