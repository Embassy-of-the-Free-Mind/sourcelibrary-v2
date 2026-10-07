#!/usr/bin/env node
// PRIOR ART: tengyur-characterize/sample.mjs reads a sample, scripts/eval/tengyur-ref/dump-pages.mjs dumps whole
// volumes that carry an 84000 text. Neither dumps every Tengyur page, which the verse detector (#6141) needs.
/**
 * dump-pages.mjs — read-only, $0. Every Derge Tengyur page (page_number > 0) as one JSON line: Tibetan, English,
 * and the translation guards (source, human edit). The dump stays on the box (1 GB).
 *   node --env-file=… scripts/eval/tengyur-improve/dump-pages.mjs /root/timp/tengyur-pages.jsonl
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import { sectionOf } from '../tengyur-characterize/common.mjs';

const OUT = process.argv[2] || '/root/timp/tengyur-pages.jsonl';
const c = await MongoClient.connect(process.env.MONGODB_URI); const db = c.db('bookstore');
const books = await db.collection('books').find({ 'catalog_ids.derge_tengyur_volume': { $exists: true } }, { projection: { _id: 0, id: 1, title: 1, catalog_ids: 1 } }).toArray();
const out = fs.createWriteStream(OUT);
let n = 0, en = 0;
for (const b of books) {
  const cur = db.collection('pages').find({ book_id: b.id, page_number: { $gt: 0 } }, { projection: { _id: 0, id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.source': 1, 'translation.edited_by': 1, 'translation.edited_at': 1, 'translation.model': 1 } });
  for await (const p of cur) {
    n++; if (p.translation?.data) en++;
    out.write(JSON.stringify({ id: p.id, book_id: b.id, vol: b.catalog_ids.derge_tengyur_volume, section: sectionOf(b.title), pn: p.page_number, bo: p.ocr?.data || '', en: p.translation?.data || '', src: p.translation?.source, ed: !!(p.translation?.edited_by || p.translation?.edited_at), model: p.translation?.model }) + '\n');
  }
}
out.end(); console.log({ books: books.length, pages: n, with_en: en });
await c.close();
