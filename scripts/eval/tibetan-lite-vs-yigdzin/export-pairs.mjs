// yigdzin-527 comparison, step 1 (#4523): export lite/Yigdzin pairs as fixed in
// scripts/eval/PREREGISTRATION-tibetan-lite-vs-yigdzin.md. Read-only.
// PRIOR ART: /root/tibetan-reocr/pull-old-text.mjs (pulls the pre-overwrite text per page). That one reads `pages`
// before an overwrite; here the lite text lives in `page_revisions` (apply-reocr-verdicts snapshots it), so the join is new.
// A pair: current ocr.model bdrc-yigdzin-v1 with engine.run yigdzin-leaf-2026-10-03, plus a page_revisions row
// (field ocr, model gemini-3.1-flash-lite, reason reocr_bdrc_4523); earliest row when there are several.
// Out (results dir): pairs-all.jsonl (every pair), pairs-sample.jsonl (one per book: min sha256("4523:"+page_id)),
//                    books-no-pair.jsonl (the 527 books without a pair, with why).
import fs from 'node:fs';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
const OUT = process.argv[2] || '/root/yig527/results';
fs.mkdirSync(OUT, { recursive: true });
const books = fs.readFileSync('/root/yig527/books-527.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const m = new MongoClient(process.env.MONGODB_URI); await m.connect();
const db = m.db('bookstore');
const h = (s) => crypto.createHash('sha256').update(s).digest('hex');
const all = fs.createWriteStream(`${OUT}/pairs-all.jsonl`); const sample = fs.createWriteStream(`${OUT}/pairs-sample.jsonl`);
const nopair = fs.createWriteStream(`${OUT}/books-no-pair.jsonl`);
let nAll = 0, nSample = 0;
for (const b of books) {
  const meta = await db.collection('books').findOne({ id: b.book }, { projection: { title: 1, image_source: 1 } });
  const revs = await db.collection('page_revisions').find({ book_id: b.book, field: 'ocr', model: 'gemini-3.1-flash-lite', reason: 'reocr_bdrc_4523' },
    { projection: { page_id: 1, data: 1, created_at: 1 } }).sort({ created_at: 1 }).toArray();
  const lite = new Map();
  for (const r of revs) if (!lite.has(r.page_id)) lite.set(r.page_id, r);
  if (!lite.size) {
    const stillLite = await db.collection('pages').countDocuments({ book_id: b.book, 'ocr.model': 'gemini-3.1-flash-lite' });
    nopair.write(JSON.stringify({ book: b.book, title: b.title, why: 'no-lite-revision', lite_pages_still_served: stillLite }) + '\n'); continue;
  }
  const pages = await db.collection('pages').find({ id: { $in: [...lite.keys()] }, 'ocr.model': 'bdrc-yigdzin-v1', 'ocr.engine.run': 'yigdzin-leaf-2026-10-03' },
    { projection: { id: 1, page_number: 1, archived_photo: 1, 'ocr.data': 1 } }).toArray();
  if (!pages.length) { nopair.write(JSON.stringify({ book: b.book, title: b.title, why: 'no-yigdzin-page-among-lite-revisions' }) + '\n'); continue; }
  const rows = pages.map((p) => ({ book: b.book, title: meta?.title ?? b.title, provider: meta?.image_source?.provider ?? null, page_id: p.id, page: p.page_number,
    image: p.archived_photo, lite: lite.get(p.id).data, yig: p.ocr.data, key: h(`4523:${p.id}`) }));
  for (const r of rows) { all.write(JSON.stringify(r) + '\n'); nAll++; }
  rows.sort((a, c) => (a.key < c.key ? -1 : 1));
  sample.write(JSON.stringify(rows[0]) + '\n'); nSample++;
}
all.end(); sample.end(); nopair.end();
console.log(JSON.stringify({ books: books.length, pairs_all: nAll, sample: nSample }));
await m.close();
