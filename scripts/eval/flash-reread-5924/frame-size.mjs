#!/usr/bin/env node
// PRIOR ART: draw.mjs here (same frame query) — that stops at 14 books; this counts the whole frame for the price.
// frame-size.mjs — lite-read books and their lite pages in the test frame (#5924). Read only.
// Writes $JOB_SCRATCH/frame-size.json: per book {book_id, ocr_pages, lite_pages}; and the totals for books ≥ 70% lite.
import { MongoClient } from 'mongodb';
import fs from 'node:fs'; import path from 'node:path';
const yearOf = p => +((String(p ?? '').match(/1[4-8]\d\d/) || [])[0]) || null;
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db(process.env.MONGODB_DB || 'bookstore');
const rows = await db.collection('books').find({ language: /latin|^lat$|^la$/i, visible: true, pages_count: { $gt: 0 }, pages_ocr: { $gte: 100 } },
  { projection: { id: 1, published: 1, duplicate_of: 1, format: 1, content_type: 1, script_type: 1 } }).toArray();
const frame = rows.map(b => ({ book_id: b.id || String(b._id), year: yearOf(b.published), b }))
  .filter(x => x.year >= 1500 && x.year <= 1800 && !x.b.duplicate_of && !/manuscri/i.test(`${x.b.format || ''} ${x.b.content_type || ''} ${x.b.script_type || ''}`));
const out = [];
for (let i = 0; i < frame.length; i += 100) {
  const ids = frame.slice(i, i + 100).map(x => x.book_id);
  const agg = await db.collection('pages').aggregate([
    { $match: { book_id: { $in: ids }, 'ocr.data': { $exists: true, $ne: '' } } },
    { $group: { _id: '$book_id', ocr: { $sum: 1 }, lite: { $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ['$ocr.model', ''] }, regex: 'flash-lite' } }, 1, 0] } } } },
  ], { allowDiskUse: true }).toArray();
  for (const a of agg) out.push({ book_id: a._id, ocr_pages: a.ocr, lite_pages: a.lite });
  process.stdout.write(`${Math.min(i + 100, frame.length)}/${frame.length}\r`);
}
const lite = out.filter(x => x.lite_pages / x.ocr_pages >= 0.7);
const tot = { frame_books: frame.length, measured: out.length, lite_books: lite.length, lite_pages: lite.reduce((s, x) => s + x.lite_pages, 0), lite_books_ocr_pages: lite.reduce((s, x) => s + x.ocr_pages, 0) };
fs.writeFileSync(path.join(process.env.JOB_SCRATCH || '/tmp', 'frame-size.json'), JSON.stringify({ at: new Date().toISOString(), totals: tot, books: out }, null, 1));
console.log('\n' + JSON.stringify(tot));
await c.close();
