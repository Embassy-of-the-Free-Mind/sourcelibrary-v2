#!/usr/bin/env node
// PRIOR ART: scripts/eval/lib/sampling.mjs sampleOnePagePerBook — draws books AND pages with
// $sample, which lands on big documents (visibility-and-stats.md, 2026-10-01) and is not
// reproducible; benchmark-seal.mjs / cursive-census-draw.mjs seal per-stratum engine sets with
// an OCR-length screen. The census needs every live translated book, no screen, a seeded
// offset per book, and a checkpoint that survives a slow Atlas (#5545).
/**
 * quality-census-draw.mjs — the A1 census draw for #5700. READ-ONLY, $0.
 *
 * Population: every live translated book (`visible: true, pages_count > 0, pages_translated > 0`).
 * One page per BOOK: a seeded random page_number in the interior (skip the first 15% and the
 * last 5% of `pages_count`), then the first page at or after it that carries a non-empty
 * `translation.data` — wrapping to the start of the interior, then to the whole book (flagged
 * `interior: false`). Uses only the {book_id, page_number} index.
 *
 * The book list is sorted by id before the RNG runs, so the draw is a pure function of the
 * seed and the population. Output is appended per book to draw.jsonl (resumable: books
 * already in the file are skipped).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/quality-census-draw.mjs \
 *     [--seed 5700] [--out scripts/eval/results/quality-census-2026-10] [--concurrency 6]
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { makeRng } from './lib/paired-stats.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SEED = Number(arg('--seed', 5700));
const OUT = arg('--out', 'scripts/eval/results/quality-census-2026-10');
const CONC = Number(arg('--concurrency', 6));
const DRAW = path.join(OUT, 'draw.jsonl');
fs.mkdirSync(OUT, { recursive: true });

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');

const books = await db.collection('books').find(
  { visible: true, pages_count: { $gt: 0 }, pages_translated: { $gt: 0 } },
  { projection: { id: 1, title: 1, display_title: 1, language: 1, original_language: 1, year: 1, published: 1, pages_count: 1, pages_translated: 1 } },
).toArray();
for (const b of books) b.bid = b.id || String(b._id);
books.sort((a, b) => (a.bid < b.bid ? -1 : a.bid > b.bid ? 1 : 0));

// One RNG draw per book in sorted order, BEFORE any resume skipping, so a resumed run
// draws the same page for every book.
const rng = makeRng(SEED);
const plan = books.map(b => {
  const pc = b.pages_count;
  const lo = Math.min(pc, Math.floor(pc * 0.15) + 1);
  const hi = Math.max(lo, pc - Math.floor(pc * 0.05));
  const u = rng();
  return { b, lo, hi, target: lo + Math.floor(u * (hi - lo + 1)) };
});

const done = new Set();
if (fs.existsSync(DRAW)) for (const l of fs.readFileSync(DRAW, 'utf8').split('\n')) if (l) done.add(JSON.parse(l).book_id);
console.error(`population ${books.length} books; already drawn ${done.size}; seed ${SEED}`);
fs.writeFileSync(path.join(OUT, 'population.json'), JSON.stringify({
  seed: SEED, drawn_at: new Date().toISOString(), books: books.length,
  pages_translated_sum: books.reduce((s, b) => s + (b.pages_translated || 0), 0),
  pages_count_sum: books.reduce((s, b) => s + (b.pages_count || 0), 0),
}, null, 2));

const pages = db.collection('pages');
const PROJ = {
  _id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'ocr.language': 1, 'ocr.model': 1, 'ocr.prompt_version': 1,
  'translation.data': 1, 'translation.model': 1, 'translation.prompt_version': 1, 'translation.updated_at': 1,
  translation_withheld: 1, translation_stale: 1,
};
const HAS_TR = { 'translation.data': { $type: 'string', $ne: '' } };
async function first(bid, range) {
  return pages.find({ book_id: bid, page_number: range, ...HAS_TR }, { projection: PROJ })
    .sort({ page_number: 1 }).hint({ book_id: 1, page_number: 1 }).limit(1).maxTimeMS(120000).next();
}

const out = fs.createWriteStream(DRAW, { flags: 'a' });
const todo = plan.filter(p => !done.has(p.b.bid));
let n = 0, fails = 0;
async function worker() {
  for (;;) {
    const p = todo.shift();
    if (!p) return;
    const { b, lo, hi, target } = p;
    let page = null, interior = true, err = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        page = await first(b.bid, { $gte: target, $lte: hi })
          || await first(b.bid, { $gte: lo, $lt: target });
        if (!page) { interior = false; page = await first(b.bid, { $gte: 0 }); }
        err = null;
        break;
      } catch (e) { err = String(e.message || e); await new Promise(r => setTimeout(r, 5000 * (attempt + 1))); }
    }
    if (err) { fails++; console.error(`FAIL ${b.bid}: ${err}`); continue; }
    out.write(JSON.stringify({
      book_id: b.bid, title: b.display_title || b.title, language: b.language || null,
      original_language: b.original_language || null, year: b.year ?? b.published ?? null,
      pages_count: b.pages_count, pages_translated: b.pages_translated,
      lo, hi, target, interior, found: !!page,
      page_id: page ? String(page._id) : null, page_number: page?.page_number ?? null, page_type: page?.page_type ?? null,
      ocr: page?.ocr?.data ?? null, ocr_language: page?.ocr?.language ?? null, ocr_model: page?.ocr?.model ?? null,
      ocr_prompt_version: page?.ocr?.prompt_version ?? null,
      tr: page?.translation?.data ?? null, tr_model: page?.translation?.model ?? null,
      tr_prompt_version: page?.translation?.prompt_version ?? null, tr_updated_at: page?.translation?.updated_at ?? null,
      withheld: page?.translation_withheld?.reason ?? null, stale: page?.translation_stale?.reason ?? null,
    }) + '\n');
    if (++n % 500 === 0) console.error(`${n}/${todo.length + n} drawn`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
out.end();
await new Promise(r => out.on('finish', r));
console.error(`done: ${n} drawn this run, ${fails} failed (re-run to retry)`);
await client.close();
