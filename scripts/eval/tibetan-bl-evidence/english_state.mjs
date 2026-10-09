// PRIOR ART: scripts/eval/tibetan-lite-vs-yigdzin/scope.mjs (counts the held books' OCR models) — it does not ask
// whether a page's stored ENGLISH was made from the text served now. This does, per stratum (#4523): English newer
// than the page's current OCR (made from it), older (made from a previous read), or none. Read-only.
//   node --env-file=/root/sourcelibrary/.env.production.local english_state.mjs /root/tib-bl-evidence/strata.json
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire('/root/sourcelibrary/package.json');
const { MongoClient } = require('mongodb');
const strata = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const pages = c.db('bookstore').collection('pages');
const out = {};
for (const b of strata) {
  const rows = await pages.aggregate([
    { $match: { book_id: b.id, page_number: { $gt: 0 } } },
    { $project: { tr: { $gt: [{ $strLenCP: { $ifNull: ['$translation.data', ''] } }, 0] }, tu: '$translation.updated_at', ou: '$ocr.updated_at',
      unr: { $ifNull: ['$ocr.unreadable', false] }, om: '$ocr.model', tm: '$translation.model' } },
    { $group: { _id: { tr: '$tr', after: { $cond: [{ $and: ['$tr', { $gte: ['$tu', '$ou'] }] }, true, false] }, unr: { $cond: ['$unr', true, false] }, tm: '$tm' }, n: { $sum: 1 } } },
  ]).toArray();
  const k = `${b.stratum}`;
  const o = (out[k] ||= { books: 0, pages: 0, en_from_current_ocr: 0, en_from_older_ocr: 0, no_en: 0, unreadable: 0, no_en_readable: 0, en_on_unreadable: 0, en_models: {} });
  o.books++;
  for (const r of rows) {
    o.pages += r.n;
    if (r._id.unr) o.unreadable += r.n;
    if (!r._id.tr) o.no_en += r.n; else if (r._id.after) o.en_from_current_ocr += r.n; else o.en_from_older_ocr += r.n;
    if (!r._id.tr && !r._id.unr) o.no_en_readable += r.n;
    if (r._id.tr && r._id.unr) o.en_on_unreadable += r.n;
    if (r._id.tr) o.en_models[r._id.tm || 'unknown'] = (o.en_models[r._id.tm || 'unknown'] || 0) + r.n;
  }
}
console.log(JSON.stringify(out, null, 1));
await c.close();
