// PRIOR ART: scripts/audit/* and the /admin/spend by-language page count books, not OCR'd / served-English PAGES per provider for three languages; none fits.
// Run from a dir with node_modules + .env: node --env-file=.env holdings.mjs  →  holdings-books.jsonl (one row per book).
// Holdings map for Tibetan / Sanskrit / Pali. Writes holdings-books.jsonl + prints summary.
import { MongoClient } from 'mongodb';
import fs from 'fs';
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const LANGS = ['Tibetan', 'Sanskrit', 'Pali'];
const books = await db.collection('books').find({ language: { $in: LANGS } }, {
  projection: { _id: 1, id: 1, title: 1, display_title: 1, author: 1, language: 1, visible: 1, hidden: 1, hidden_reason: 1, pages_count: 1,
    contributing_library: 1, image_source: 1, acquisition_campaign: 1, ia_identifier: 1, collections: 1, published: 1, year: 1,
    'pipeline_auto.status': 1, 'pipeline_auto.hold': 1, work_title: 1, catalog_metadata: 1 }
}).toArray();
console.log('books', books.length);
const ids = books.map(b => b.id || String(b._id));
const agg = new Map();
const CH = 200;
for (let i = 0; i < ids.length; i += CH) {
  const rows = await db.collection('pages').aggregate([
    { $match: { book_id: { $in: ids.slice(i, i + CH) } } },
    { $group: { _id: '$book_id', n: { $sum: 1 },
      ocr: { $sum: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$ocr.data', ''] } }, 20] }, 1, 0] } },
      tr: { $sum: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$translation.data', ''] } }, 20] }, 1, 0] } },
      wh: { $sum: { $cond: [{ $ifNull: ['$translation_withheld', false] }, 1, 0] } },
      ocrModels: { $addToSet: '$ocr.model' },
    } }
  ], { allowDiskUse: true }).toArray();
  for (const r of rows) agg.set(r._id, r);
  process.stderr.write(`${i + CH}/${ids.length}\r`);
}
const out = fs.createWriteStream('holdings-books.jsonl');
for (const b of books) {
  const id = b.id || String(b._id);
  const a = agg.get(id) || { n: 0, ocr: 0, tr: 0, wh: 0, ocrModels: [] };
  out.write(JSON.stringify({ id, title: b.display_title || b.title, author: b.author, language: b.language, visible: !!b.visible,
    hidden_reason: b.hidden_reason || null, pages_count: b.pages_count, lib: b.contributing_library?.name || b.contributing_library || null,
    image_source: b.image_source?.provider || b.image_source?.type || (typeof b.image_source === 'string' ? b.image_source : null),
    campaign: b.acquisition_campaign || null, ia: b.ia_identifier || null, collections: b.collections || [], published: b.published || b.year || null,
    status: b.pipeline_auto?.status || null, hold: b.pipeline_auto?.hold?.reason || null,
    pages: a.n, ocr: a.ocr, tr: a.tr, withheld: a.wh, ocrModels: (a.ocrModels || []).filter(Boolean).slice(0, 5) }) + '\n');
}
out.end();
await c.close();
