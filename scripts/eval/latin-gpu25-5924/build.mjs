#!/usr/bin/env node
/**
 * latin-gpu25-5924/build.mjs — the page manifest and the frozen stored-OCR references for the GPU arm of #5924:
 * do 25 spread pages predict whether a Latin book can go to GPU OCR?
 *
 * PRIOR ART: scripts/eval/latin-repair-census-5924/gpu-plan.mjs (PR #7173; its gpu-plan.json is copied here unchanged,
 *   ids and page numbers only) and ./leaves.mjs there (getPageSource on the same projection — the leaf the stored OCR
 *   read); scripts/eval/latin-bakeoff-5924/backlog-manifest.mjs (the tsv shape fetch-chunk.py reads: url in column 4).
 *
 *   node --env-file=<main>/.env.production.local build.mjs
 * Read only. Writes $JOB_SCRATCH/manifest-spread.tsv, manifest-whole.tsv (page_id, book_id, page_number, url) and
 * $JOB_SCRATCH/refs.jsonl.gz ({page_id, book_id, page_number, set, model, text}: pages.ocr.data as of this run).
 * Whole books = every page of the book with non-empty ocr.data (the census's pages_with_ocr).
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { getPageSource } from '../../lib/page-image-url.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.JOB_SCRATCH; if (!OUT) throw new Error('JOB_SCRATCH unset');
const plan = JSON.parse(fs.readFileSync(path.join(HERE, 'gpu-plan.json'), 'utf8'));
const PROJ = { book_id: 1, page_number: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, archived_photo: 1, enhanced_photo: 1, photo_original: 1, 'ocr.data': 1, 'ocr.model': 1 };
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const pages = c.db(process.env.MONGODB_DB || 'bookstore').collection('pages');

const refs = []; const tsv = { spread: [], whole: [] }; const stats = { spread: { pages: 0, no_url: 0, no_ocr: 0 }, whole: {} };
const add = (set, p) => {
  const page_id = `${p.book_id}-p${p.page_number}`; const url = getPageSource(p);
  if (url) tsv[set].push([page_id, p.book_id, p.page_number, url].join('\t'));
  refs.push({ page_id, book_id: p.book_id, page_number: p.page_number, set, model: p.ocr?.model || null, text: p.ocr?.data || '', url });
  return url;
};
for (const b of plan.spread25) {
  const got = await pages.find({ book_id: b.book_id, page_number: { $in: b.pages } }, { projection: PROJ }).toArray();
  stats.spread.pages += got.length;
  for (const p of got) { if (!add('spread', p)) stats.spread.no_url++; if (!String(p.ocr?.data || '').trim()) stats.spread.no_ocr++; }
}
for (const b of plan.whole) {
  const got = await pages.find({ book_id: b.book_id, 'ocr.data': { $nin: [null, ''] } }, { projection: PROJ }).sort({ page_number: 1 }).toArray();
  let noUrl = 0; for (const p of got) if (!add('whole', p)) noUrl++;
  stats.whole[b.book_id] = { plan: b.pages_with_ocr, now: got.length, no_url: noUrl };
}
await c.close();
// two page docs with one (book_id, page_number) are ambiguous about which leaf the stored text read: drop both
const seen = {}; for (const r of refs) seen[r.set + r.page_id] = (seen[r.set + r.page_id] || 0) + 1;
const dup = new Set(Object.keys(seen).filter((k) => seen[k] > 1)); stats.dropped_duplicate_page_numbers = [...dup];
for (const s of ['spread', 'whole']) tsv[s] = tsv[s].filter((l) => !dup.has(s + l.split('\t')[0]));
refs.splice(0, refs.length, ...refs.filter((r) => !dup.has(r.set + r.page_id)));
for (const s of ['spread', 'whole']) fs.writeFileSync(path.join(OUT, `manifest-${s}.tsv`), tsv[s].join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'refs.jsonl.gz'), zlib.gzipSync(refs.map((r) => JSON.stringify(r)).join('\n') + '\n'));
const hosts = {}; for (const r of refs) if (r.url) { const h = new URL(r.url).host; hosts[h] = (hosts[h] || 0) + 1; }
console.log(JSON.stringify({ ...stats, spread_tsv: tsv.spread.length, whole_tsv: tsv.whole.length, hosts }, null, 1));
