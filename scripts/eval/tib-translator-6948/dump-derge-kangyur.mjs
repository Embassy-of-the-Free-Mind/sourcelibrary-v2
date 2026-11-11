#!/usr/bin/env node
// PRIOR ART: scripts/eval/tengyur-ref/dump-pages.mjs — the same read-only volume dump, for the Derge TENGYUR (#5497) and
// by a fixed volume list. This dumps every Derge Kangyur page (ocr.pipeline derge-kangyur-import-5665), hidden volumes
// included, so #6948 can locate a manuscript Kangyur page in the Derge text and so in 84000's English.
/**
 * dump-derge-kangyur.mjs — read-only, $0. Writes $JOB_SCRATCH/derge-kangyur.jsonl:
 *   {page_id, book_id, vol, page_number, folio, texts, texts_84000, src}
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';

const S = process.env.JOB_SCRATCH;
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const books = await db.collection('books').find({ title: /Derge Kangyur, vol\. \d+/ }, { projection: { _id: 0, id: 1, title: 1 } }).toArray();
const out = fs.createWriteStream(`${S}/derge-kangyur.jsonl`);
let n = 0;
for (const b of books) {
  const vol = Number(b.title.match(/vol\. (\d+)/)[1]);
  const pages = await db.collection('pages').find({ book_id: b.id, 'ocr.pipeline': 'derge-kangyur-import-5665' },
    { projection: { _id: 0, id: 1, page_number: 1, 'ocr.data': 1, 'ocr.text_edition.folio': 1, 'ocr.text_edition.texts': 1, 'ocr.text_edition.texts_84000': 1 } }).toArray();
  for (const p of pages) {
    const te = p.ocr?.text_edition || {};
    out.write(JSON.stringify({ page_id: p.id, book_id: b.id, vol, page_number: p.page_number, folio: te.folio || null, texts: te.texts || [], texts_84000: te.texts_84000 || {}, src: p.ocr?.data || '' }) + '\n');
    n++;
  }
}
out.end();
console.log(books.length, 'volumes', n, 'pages');
await c.close();
