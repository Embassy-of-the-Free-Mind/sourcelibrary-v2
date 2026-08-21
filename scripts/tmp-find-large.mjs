import { MongoClient } from 'mongodb';
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');

const langs = ['Greek','Hebrew','Arabic','Persian','Sanskrit','Chinese','Armenian','Church Slavonic'];

for (const lang of langs) {
  const books = await db.collection('books').find({
    language: lang, pages_count: { $gt: 0 }, visible: true,
  }, { projection: { id: 1, title: 1 } }).limit(30).toArray();
  const bookIds = books.map(b => b.id);
  const pages = await db.collection('pages').find({
    book_id: { $in: bookIds },
    'ocr.data': { $exists: true, $ne: null },
    $or: [{ 'transliteration.data': { $exists: false } }, { 'transliteration.data': null }]
  }, { projection: { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, tenantId: 1 } })
  .toArray();
  const withLen = pages.map(p => ({ ...p, len: p.ocr.data.length })).sort((a,b) => b.len - a.len);
  if (withLen.length) {
    const top = withLen[0];
    const book = books.find(b => b.id === top.book_id);
    console.log(lang, 'max_len:', top.len, 'page_id:', top.id, 'book:', book?.title, 'tenantId:', top.tenantId);
  } else {
    console.log(lang, 'no candidates found among', bookIds.length, 'books');
  }
}
await client.close();
