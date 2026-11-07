// Read-only: pull live OCR + translation for the adjudicated pages (#7611).
// PRIOR ART: scripts/eval/judge-compare-7611/run.mjs mongo() — same read, plus the translation and OCR dates this eval needs (#7611).
import { MongoClient } from 'mongodb';
import fs from 'fs'; import zlib from 'zlib';
const ids = JSON.parse(fs.readFileSync(process.argv[2]));
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const out = {};
for (const pid of ids) {
  const p = await db.collection('pages').findOne({ $or: [{ id: pid }, { _id: pid }] },
    { projection: { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'ocr.updated_at': 1, 'ocr.model': 1, 'ocr.source': 1, 'ocr.text_hash': 1,
      translation: 1, translation_withheld: 1 } });
  let revs = [];
  if (p) revs = await db.collection('page_revisions').find({ page_id: p.id || pid }, { projection: { field: 1, created_at: 1, source: 1 } }).sort({ created_at: 1 }).toArray().catch(() => []);
  out[pid] = { page: p, revs: revs.map(r => ({ field: r.field, at: r.created_at, source: r.source })) };
}
fs.writeFileSync(process.argv[3], zlib.gzipSync(JSON.stringify(out)));
console.log('found', Object.values(out).filter(x => x.page).length, 'of', ids.length);
await c.close();
