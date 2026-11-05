#!/usr/bin/env node
// PRIOR ART: scripts/eval/wrong-leaf-find-5021/replay.mjs (#5021) replays BLOCK calls (several leaves in one call) and
// attributes sections against one-page references; it does not fit because the failure here is a SINGLE-page call with
// the previous page's English appended as "continuity" (src/workers/translation-processor-logic.ts → src/lib/ai.ts
// performTranslation, Feb–Mar 2026), so the arm under test is the context string, not the block. The call itself is
// scripts/lib/agy-cli.mjs gatedTextCall with TRANSLATE_SUFFIX, as scripts/batch/cli-translate.mjs sends it.
/**
 * Replay of the Feb 2026 Lambda translation call on near-blank caption leaves, with and without the previous page's
 * English as continuity context (#5274).
 *
 *   node --env-file=.env.production.local scripts/eval/context-bleed-5274/replay.mjs draw --out=DIR [--n=20] [--seed=52741]
 *   … run --out=DIR [--reps=1]
 *   … score --out=DIR
 *
 * draw   n caption leaves from the #5274 near-blank withhold list, one per book, seeded, whose page n-1 has a Feb
 *        gemini-3-flash-preview English (taken from page_revisions if it was rewritten since). The leaf's OCR is the one
 *        the Feb call saw: the page_revisions snapshot the 2026-10-10 Paddle re-read took, else the current OCR.
 * run    Two arms per leaf on agy gemini-3.8-flash-low (NOT the original gemini-3-flash-preview, which is paid-API only
 *        and forbidden here): the DB prompt "Standard Translation" v2 (the prompt_hash stamped on these pages), filled as
 *        performTranslation filled it, + "**Text to translate:**" + the OCR, and in arm `ctx` + "**Previous page
 *        translation for continuity:**" + the first 2,000 characters of n-1's English + "...". The same TRANSLATE_SUFFIX
 *        on both arms.
 * score  For each reply: share of its English content words (≥ 4 letters, not stopwords) found in n-1's English, and the
 *        same for the stored (withheld) English as the reference point. A reply "carries the previous leaf" when that
 *        share is ≥ 0.5 and it has ≥ 40 content words.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { gatedTextCall, TRANSLATE_SUFFIX } from '../../lib/agy-cli.mjs';

const MODE = process.argv[2];
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const OUT = path.resolve(arg('out', '.'));
fs.mkdirSync(OUT, { recursive: true });
const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '..', '..', '..');
const MODEL = 'gemini-3.8-flash-low';
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const STOP = new Set('this that with from which their there these those have been were what when where while would could should about after before other into only also such than then them they upon your more most some very over under page text leaf entry volume chapter section original note continues previous illustration illustrated depicts shows translation'.split(' '));
export const words = (s) => String(s || '').replace(/<(meta|summary|keywords|vocab)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').toLowerCase().match(/[a-z]{4,}/g)?.filter((w) => !STOP.has(w)) || [];
export function shareIn(a, b) { const A = words(a); const B = new Set(words(b)); if (!A.length) return { n: 0, share: 0 }; return { n: A.length, share: A.filter((w) => B.has(w)).length / A.length }; }

async function febEnglish(db, p) {
  const t = p.translation;
  if (t?.data && /gemini-3-flash-preview/.test(t.model || '') && new Date(t.updated_at) < new Date('2026-04-01')) return t.data;
  const w = p.translation_withheld;
  if (w?.text && new Date(w.updated_at) < new Date('2026-04-01')) return w.text;
  const rev = await db.collection('page_revisions').find({ page_id: p.id, field: 'translation', model: 'gemini-3-flash-preview' }).sort({ created_at: 1 }).limit(1).toArray();
  return typeof rev[0]?.data === 'string' ? rev[0].data : null;
}

async function draw(db) {
  const N = Number(arg('n', 20)), rnd = mulberry32(Number(arg('seed', 52741)));
  const W = fs.readFileSync(path.join(ROOT, 'scripts/eval/results/zh-near-blank-screen-5274/withhold-candidates.tsv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split('\t'));
  const byBook = new Map();
  for (const [b, n] of W) { const a = byBook.get(b) || []; a.push(Number(n)); byBook.set(b, a); }
  const books = [...byBook.keys()].sort();
  for (let i = books.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [books[i], books[j]] = [books[j], books[i]]; }
  const picked = [];
  for (const b of books) {
    if (picked.length >= N) break;
    const ns = byBook.get(b);
    const n = ns[Math.floor(rnd() * ns.length)];
    const [me, prev] = await Promise.all([n, n - 1].map((k) => db.collection('pages').findOne({ book_id: b, page_number: k })));
    if (!me || !prev) continue;
    const stored = me.translation_withheld?.text || me.translation?.data;
    const ctx = await febEnglish(db, prev);
    if (!stored || !ctx) continue;
    let ocr = me.ocr?.data || '';
    const orev = await db.collection('page_revisions').find({ page_id: me.id, field: 'ocr', created_at: { $gt: new Date('2026-10-01') } }).sort({ created_at: 1 }).limit(1).toArray();
    if (/Paddle/i.test(me.ocr?.model || '') && typeof orev[0]?.data === 'string') ocr = orev[0].data;
    const book = await db.collection('books').findOne({ id: b }, { projection: { title: 1, language: 1 } });
    picked.push({ book_id: b, page: n, page_id: me.id, title: book?.title, language: book?.language || 'Chinese', ocr, ctx, stored, stored_model: (me.translation_withheld || me.translation)?.model });
  }
  fs.writeFileSync(path.join(OUT, 'draw.json'), JSON.stringify(picked, null, 1));
  console.log(`drew ${picked.length}`);
}

async function run(db) {
  const items = JSON.parse(fs.readFileSync(path.join(OUT, 'draw.json'), 'utf8'));
  const v2 = await db.collection('prompts').findOne({ name: 'Standard Translation', version: 2 });
  const base = v2.content.replace('{source_language}', 'Chinese').replace('{target_language}', 'English');
  const resF = path.join(OUT, 'replies.jsonl');
  const done = new Set(readJsonl(resF).filter((r) => r.text).map((r) => `${r.page_id}:${r.arm}:${r.rep}`));
  const reps = Number(arg('reps', 1));
  const jobs = [];
  for (const it of items) for (const arm of ['ctx', 'none']) for (let rep = 0; rep < reps; rep++) if (!done.has(`${it.page_id}:${arm}:${rep}`)) jobs.push({ it, arm, rep });
  const worker = async () => {
    for (let j = jobs.shift(); j; j = jobs.shift()) {
      const { it, arm, rep } = j;
      let prompt = `${base}\n\n**Text to translate:**\n${it.ocr}`;
      if (arm === 'ctx') prompt += `\n\n**Previous page translation for continuity:**\n${it.ctx.slice(0, 2000)}...`;
      const r = await gatedTextCall(`${prompt}${TRANSLATE_SUFFIX}`, { model: MODEL, task: 'translate', tmp: process.env.TMPDIR });
      fs.appendFileSync(resF, JSON.stringify({ page_id: it.page_id, book_id: it.book_id, page: it.page, arm, rep, model: MODEL, text: r.answer || null, problem: r.problem || null, cls: r.cls || null }) + '\n');
      console.log(`${it.book_id} p${it.page} ${arm}: ${r.cls || r.problem || (r.answer || '').length}`);
      if (r.cls === 'quota') { jobs.length = 0; console.log('quota: stopping'); }
    }
  };
  await Promise.all(Array.from({ length: Number(arg('concurrency', 4)) }, worker));
}

function score() {
  const items = new Map(JSON.parse(fs.readFileSync(path.join(OUT, 'draw.json'), 'utf8')).map((i) => [i.page_id, i]));
  const rs = readJsonl(path.join(OUT, 'replies.jsonl')).filter((r) => r.text);
  const carries = (s) => s.n >= 40 && s.share >= 0.5;
  const rows = [];
  for (const [id, it] of items) {
    const st = shareIn(it.stored, it.ctx);
    const arms = {};
    for (const arm of ['ctx', 'none']) arms[arm] = rs.filter((r) => r.page_id === id && r.arm === arm).map((r) => shareIn(r.text, it.ctx));
    rows.push({ page_id: id, book_id: it.book_id, page: it.page, ocr_chars: it.ocr.length, stored: st, stored_carries: carries(st), ctx: arms.ctx, none: arms.none, ctx_carries: arms.ctx.filter(carries).length, none_carries: arms.none.filter(carries).length });
  }
  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
  const out = {
    leaves: rows.length, model: MODEL, note: 'agy gemini-3.8-flash-low stands in for gemini-3-flash-preview (paid API only, forbidden); prompt = DB Standard Translation v2, context = first 2,000 chars of n-1 Feb English',
    stored_carries: rows.filter((r) => r.stored_carries).length,
    ctx_replies: rows.reduce((s, r) => s + r.ctx.length, 0), ctx_carries: sum('ctx_carries'),
    none_replies: rows.reduce((s, r) => s + r.none.length, 0), none_carries: sum('none_carries'),
    median_share: { ctx: med(rows.flatMap((r) => r.ctx.map((x) => x.share))), none: med(rows.flatMap((r) => r.none.map((x) => x.share))), stored: med(rows.map((r) => r.stored.share)) },
    median_words: { ctx: med(rows.flatMap((r) => r.ctx.map((x) => x.n))), none: med(rows.flatMap((r) => r.none.map((x) => x.n))), stored: med(rows.map((r) => r.stored.n)) },
    rows,
  };
  fs.writeFileSync(path.join(OUT, 'score.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ ...out, rows: undefined }, null, 1));
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? +s[Math.floor(s.length / 2)].toFixed(3) : null; };

if (MODE === 'score') score();
else {
  const c = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
  await c.connect();
  try { if (MODE === 'draw') await draw(c.db('bookstore')); if (MODE === 'run') await run(c.db('bookstore')); } finally { await c.close(); }
}
