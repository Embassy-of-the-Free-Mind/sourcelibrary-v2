#!/usr/bin/env node
// build-manifest.mjs — the fixed input set for the GEX45 capability card (#6871): ~100 page images,
// one page per book, in strata (Latin print, other European print, Greek, Chinese, Tibetan, manuscript,
// table), plus ~2,000 translated page texts for the embedding arms. READ-ONLY on Mongo.
//
// PRIOR ART: scripts/eval/benchmark-seal.mjs (seals per-stratum sets for QUALITY scoring against pinned
// references; this card measures speed and VRAM only, so no references are needed and any real page
// will do) and scripts/eval/engine-wave1-6011/build-bench.mjs (bound to that wave's reference pages).
//
//   node --env-file=.env.production.local scripts/gpu/gex45-bench-6871/build-manifest.mjs <outdir>
// Writes <outdir>/pages.tsv (stratum, book_id, page_number, url, language, year) and
// <outdir>/texts.jsonl ({book_id, page_number, text}) — the texts stay out of the repo (size).
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2];
if (!out) throw new Error('usage: build-manifest.mjs <outdir>');
fs.mkdirSync(out, { recursive: true });
const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');
const books = db.collection('books');
const pages = db.collection('pages');
const live = { visible: true, pages_count: { $gt: 20 }, content_type: { $ne: 'artwork' } };
const seen = new Set();

// one interior page with an archived master image from a book (not blank, not the title page)
async function pickPage(book, extra = {}) {
  const n = book.pages_count;
  const lo = Math.max(2, Math.floor(n * 0.2)), hi = Math.max(lo + 1, Math.floor(n * 0.8));
  const ps = await pages.find({ book_id: book.id, page_number: { $gte: lo, $lte: hi }, archived_photo: { $exists: true },
    page_type: { $nin: ['blank', 'illustration', 'archived-spread', 'title-page'] }, ...extra },
    { projection: { page_number: 1, archived_photo: 1 } }).limit(40).toArray();
  return ps.length ? ps[Math.floor(Math.random() * ps.length)] : null;
}

const rows = [];
async function stratum(name, match, want) {
  const cands = await books.aggregate([{ $match: { ...live, ...match } }, { $sample: { size: want * 4 } },
    { $project: { id: 1, pages_count: 1, language: 1, year: 1 } }]).toArray();
  let got = 0;
  for (const b of cands) {
    if (got >= want) break;
    if (seen.has(b.id)) continue;
    const p = await pickPage(b);
    if (!p) continue;
    seen.add(b.id);
    rows.push([name, b.id, p.page_number, p.archived_photo, b.language ?? '', b.year ?? '']);
    got++;
  }
  console.log(name, got, '/', want);
}

const latin = { language: 'Latin' };
await stratum('latin-pre1700', { ...latin, year: { $lt: 1700 } }, 25);
await stratum('latin-1700plus', { ...latin, year: { $gte: 1700 } }, 15);
await stratum('euro-print', { language: { $in: ['German', 'English', 'French', 'Italian', 'Dutch'] }, title: { $not: /manuscri|handschrift/i } }, 15);
await stratum('greek', { language: 'Greek' }, 5);
await stratum('chinese', { language: 'Chinese' }, 20);
await stratum('tibetan', { language: 'Tibetan' }, 4);
await stratum('manuscript', { title: /manuscri|handschrift|\bcodex\b/i, language: { $in: ['Latin', 'German', 'English', 'Italian', 'French', 'Dutch'] } }, 8);

// tables: pages whose stored OCR carries a markdown or HTML table, one per book
const tables = await pages.aggregate([{ $sample: { size: 150000 } },
  { $match: { 'ocr.data': /\|\s*-{3,}|<table/i, archived_photo: { $exists: true } } },
  { $project: { book_id: 1, page_number: 1, archived_photo: 1 } }, { $limit: 200 }], { allowDiskUse: true }).toArray();
let nt = 0;
for (const p of tables) {
  if (nt >= 8) break;
  if (seen.has(p.book_id)) continue;
  const b = await books.findOne({ id: p.book_id, ...live }, { projection: { language: 1, year: 1 } });
  if (!b) continue;
  seen.add(p.book_id);
  rows.push(['table', p.book_id, p.page_number, p.archived_photo, b.language ?? '', b.year ?? '']);
  nt++;
}
console.log('table', nt, '/ 8');
fs.writeFileSync(path.join(out, 'pages.tsv'), rows.map(r => r.join('\t')).join('\n') + '\n');

// ~2,000 translated page texts for the embedding arms, at most 4 pages per book
const tp = await pages.aggregate([{ $sample: { size: 12000 } },
  { $match: { 'translation.data': { $type: 'string' } } },
  { $project: { book_id: 1, page_number: 1, text: '$translation.data' } }], { allowDiskUse: true }).toArray();
const perBook = new Map();
const texts = [];
for (const p of tp) {
  if (texts.length >= 2000) break;
  const k = perBook.get(p.book_id) ?? 0;
  if (k >= 4 || (p.text ?? '').trim().length < 200) continue;
  perBook.set(p.book_id, k + 1);
  texts.push(JSON.stringify({ book_id: p.book_id, page_number: p.page_number, text: p.text }));
}
fs.writeFileSync(path.join(out, 'texts.jsonl'), texts.join('\n') + '\n');
console.log('texts', texts.length, 'from', perBook.size, 'books');
await c.close();
