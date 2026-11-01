// Read-only: dump the 14 contained pages, their books, holds and ±3 neighbours (#5274).
// PRIOR ART: none — a one-off read for this repair; writes nothing.
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
const PAGES = ['69f3276f52a77bb28fdb7316:3','69e75ccc3f15c712bdb8f04e:40','69e726a9a409200ea79efa80:17','69e4207471f02ebac6264a46:7','69e014d927a1381d255992b7:32','6991eadd2f801130a473ea3c:31','69c7fdea6c6f3cc53c84359c:143','695201a9ab34727b1f041826:82','69dfede68d34461cbe7f4df4:71','6a08e2ce50bd891addfb51e6:23','69e8b14e2ff2a8dc09e75a36:340','6a1aa51fc8638d1ea5c80d0f:142','69b3f796a107e55a0ee1e1d6:110','6a357f1ac6e2d5bb56a64539:204'];
const out = process.argv[2];
const c = await MongoClient.connect(process.env.MONGODB_URI); const db = c.db('bookstore');
const res = [];
for (const k of PAGES) {
  const [bid, n] = k.split(':'); const pn = +n;
  const b = await db.collection('books').findOne({ $or: [{ id: bid }, { _id: bid }] }, { projection: { id:1, title:1, display_title:1, author:1, language:1, original_language:1, slug:1, pipeline_auto:1, visible:1, pages_count:1, summary:1, chapters:1, ia_identifier:1, source_url:1, iiif_manifest:1, provider:1 } });
  const ps = await db.collection('pages').find({ book_id: b?.id || bid, page_number: { $gte: pn - 3, $lte: pn + 3 } }).sort({ page_number: 1 }).toArray();
  res.push({ key: k, book: b && { ...b, summary: typeof b.summary === 'string' ? b.summary.slice(0, 300) : b.summary && JSON.stringify(b.summary).slice(0,300), chapters: Array.isArray(b.chapters) ? b.chapters.length : b.chapters }, pages: ps.map(p => ({ id: p.id, n: p.page_number, photo: p.photo, archived_photo: p.archived_photo, photo_original: p.photo_original, page_type: p.page_type, ocr: p.ocr && { ...p.ocr, data: p.ocr.data }, translation: p.translation, translation_withheld: p.translation_withheld, split: p.split_from_spread, crop: p.crop })) });
}
fs.writeFileSync(out, JSON.stringify(res, null, 1));
await c.close();
