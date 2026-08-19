import { MongoClient } from 'mongodb';
const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');

// Pages that have BOTH texts, sampled across many books.
const rows = await db.collection('pages').aggregate([
  { $match: { 'ocr.data': { $type: 'string' }, 'translation.data': { $type: 'string' } } },
  { $sample: { size: 4000 } },
  { $project: { book_id: 1, o: '$ocr.data', t: '$translation.data' } },
], { allowDiskUse: true }).toArray();

const perBook = new Map();
let bothQ = 0, ocrOnly = 0, transOnly = 0, neither = 0;
for (const r of rows) {
  const oq = /^>/m.test(r.o);
  const tq = /^>/m.test(r.t);
  if (oq && tq) bothQ++; else if (oq) ocrOnly++; else if (tq) transOnly++; else neither++;
  const b = perBook.get(r.book_id) || { n: 0, oq: 0, tq: 0 };
  b.n++; if (oq) b.oq++; if (tq) b.tq++;
  perBook.set(r.book_id, b);
}
console.log('sampled pages:', rows.length, 'books:', perBook.size);
console.log('blockquote in BOTH panes :', bothQ);
console.log('blockquote in OCR only   :', ocrOnly);
console.log('blockquote in TRANS only :', transOnly);
console.log('neither                  :', neither);
const withQ = [...perBook.values()].filter(b => b.oq > 0 || b.tq > 0);
console.log('\nbooks in sample with any blockquote:', withQ.length, '/', perBook.size);
// of pages that HAVE a quote in ocr, how often does the translation match?
const denom = bothQ + ocrOnly;
if (denom) console.log('when the transcription quotes, translation matches:', Math.round(100*bothQ/denom) + '%');
await c.close();
