// PRIOR ART: scripts/audit/gpu-queue-5660.mjs (OCR owed per GPU lane, not per script with source/model split); scripts/eval/results/greek-ms-align-5619/census-summary.json (Greek only). #5730 burst-2 census: OCR state per candidate script.
// Census of OCR state per candidate script (#5730 burst 2). Prints counts; writes census.json.
import { MongoClient } from 'mongodb';
import fs from 'fs';
const GROUPS = {
  persian_arabic: ['Persian', 'Arabic', 'ar', 'Ottoman Turkish', 'fa', 'per', 'ara', 'Urdu'],
  syriac: ['Syriac', 'syr'],
  tibetan: ['Tibetan', 'bo', 'tib'],
  chinese: ['Chinese', 'Classical Chinese', 'zh', 'lzh', 'cinese'],
  greek: ['Greek', 'grc', 'el', 'Ancient Greek'],
  hebrew: ['Hebrew', 'he', 'heb'],
};
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db(process.env.MONGODB_DB || 'bookstore');
const out = {};
for (const [g, langs] of Object.entries(GROUPS)) {
  const books = await db.collection('books').find({ language: { $in: langs }, pages_count: { $gt: 0 } },
    { projection: { id: 1, visible: 1, pages_count: 1 } }).toArray();
  const ids = books.map(b => b.id);
  const acc = { books: books.length, visible_books: books.filter(b => b.visible).length, pages: 0, no_ocr: 0, unreadable: 0, empty_or_short: 0,
    by_source_model: {}, edited_by: 0, volunteer: 0, withheld: 0 };
  for (let i = 0; i < ids.length; i += 200) {
    const cur = db.collection('pages').aggregate([
      { $match: { book_id: { $in: ids.slice(i, i + 200) } } },
      { $project: { s: '$ocr.source', m: '$ocr.model', e: { $cond: [{ $ifNull: ['$ocr.edited_by', false] }, 1, 0] },
        u: { $cond: [{ $ifNull: ['$ocr.unreadable', false] }, 1, 0] }, w: { $cond: [{ $ifNull: ['$translation_withheld', false] }, 1, 0] },
        len: { $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, { $strLenCP: '$ocr.data' }, 0] } } },
      { $group: { _id: { s: '$s', m: '$m', short: { $lt: ['$len', 40] } }, n: { $sum: 1 }, e: { $sum: '$e' }, u: { $sum: '$u' }, w: { $sum: '$w' } } },
    ], { allowDiskUse: true }).batchSize(1000);
    for await (const r of cur) {
      acc.pages += r.n; acc.edited_by += r.e; acc.unreadable += r.u; acc.withheld += r.w;
      if (r._id.s == null) acc.no_ocr += r.n; else if (r._id.short) acc.empty_or_short += r.n;
      if (r._id.s === 'volunteer-correction') acc.volunteer += r.n;
      const k = `${r._id.s}|${r._id.m}`; acc.by_source_model[k] = (acc.by_source_model[k] || 0) + r.n;
    }
  }
  out[g] = acc;
  const top = Object.entries(acc.by_source_model).sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log(g, JSON.stringify({ ...acc, by_source_model: undefined }));
  console.log('   ', top.map(([k, v]) => `${k}:${v}`).join('  '));
  fs.writeFileSync('census.json', JSON.stringify(out, null, 1));
}
await c.close();
