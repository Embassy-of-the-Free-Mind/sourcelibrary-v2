// yigdzin-527 step 1 (#4523). PRIOR ART: /root/tib-step2/build-todo.mjs (per-book page scan); this one selects books, not pages.
// Out: /root/yig527/books-527.jsonl, one row per book with page counts by page_type and by ocr.model.
// Scope: held under specialist-ocr-lane-4523 / tibetan-unverified-gemini-ocr-4523, >=1 lite page (either model id, see
// lane-lib.mjs), 0 bdrc-yigdzin-v1 pages. YIG_DIR overrides the state dir for a later run.
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { isLiteModel } from './lane-lib.mjs';
const DIR = process.env.YIG_DIR || '/root/yig527';
const m = new MongoClient(process.env.MONGODB_URI); await m.connect();
const db = m.db('bookstore');
const REASONS = ['specialist-ocr-lane-4523', 'tibetan-unverified-gemini-ocr-4523'];
const books = await db.collection('books').find({ 'pipeline_auto.hold.reason': { $in: REASONS } },
  { projection: { id: 1, _id: 1, title: 1, pages_count: 1, visible: 1, 'pipeline_auto.hold.reason': 1, provider: 1, source: 1, language: 1 } }).toArray();
console.error('held books', books.length);
const out = [];
for (const b of books) {
  const bid = b.id || String(b._id);
  const agg = await db.collection('pages').aggregate([
    { $match: { book_id: bid } },
    { $group: { _id: { t: '$page_type', m: '$ocr.model' }, n: { $sum: 1 } } },
  ]).toArray();
  let lite = 0, yig = 0, total = 0; const byType = {}, byModel = {};
  for (const r of agg) {
    total += r.n; const t = r._id.t ?? 'null'; const mo = r._id.m ?? 'none';
    byType[t] = (byType[t] || 0) + r.n; byModel[mo] = (byModel[mo] || 0) + r.n;
    if (isLiteModel(mo)) lite += r.n;
    if (mo === 'bdrc-yigdzin-v1') yig += r.n;
  }
  if (lite > 0 && yig === 0) out.push({ book: bid, title: b.title, visible: b.visible, hold: b.pipeline_auto?.hold?.reason, pages_count: b.pages_count, total, lite, byType, byModel });
}
fs.writeFileSync(`${DIR}/books-527.jsonl`, out.map((r) => JSON.stringify(r)).join('\n') + '\n');
const sum = { books: out.length, pages: out.reduce((a, r) => a + r.total, 0), lite: out.reduce((a, r) => a + r.lite, 0), byType: {}, byModel: {} };
for (const r of out) { for (const [k, v] of Object.entries(r.byType)) sum.byType[k] = (sum.byType[k] || 0) + v; for (const [k, v] of Object.entries(r.byModel)) sum.byModel[k] = (sum.byModel[k] || 0) + v; }
console.log(JSON.stringify(sum, null, 1));
await m.close();
