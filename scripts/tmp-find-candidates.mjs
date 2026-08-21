import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');

const langs = ['Greek','Hebrew','Arabic','Persian','Sanskrit','Chinese','Japanese','Korean',
  'Armenian','Georgian','Tibetan','Russian','Syriac','Coptic','Ethiopic',
  'Ottoman Turkish','Church Slavonic','Ancient Greek','Classical Chinese'];

const results = [];
const seenLangs = new Set();

for (const lang of langs) {
  if (results.filter(r => r.matchedLang === lang).length) continue;
  // exact match only (avoid multi-language composite strings)
  const books = await db.collection('books').find({
    language: lang,
    pages_count: { $gt: 0 },
    visible: true,
  }, { projection: { id: 1, title: 1, language: 1, tenantId: 1 } }).limit(15).toArray();

  for (const book of books) {
    const page = await db.collection('pages').findOne({
      book_id: book.id,
      'ocr.data': { $exists: true, $ne: null },
      $or: [
        { 'transliteration.data': { $exists: false } },
        { 'transliteration.data': null }
      ]
    }, { projection: { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, tenantId: 1 } });
    if (page && page.ocr?.data && page.ocr.data.length > 100) {
      results.push({
        matchedLang: lang,
        language: book.language,
        book_id: book.id,
        book_title: book.title,
        tenantId: book.tenantId,
        page_id: page.id,
        page_number: page.page_number,
        ocr_len: page.ocr.data.length,
      });
      break; // one page per language for now, gather more later if needed
    }
  }
}

console.log(`Total candidates: ${results.length}`);
console.log(JSON.stringify(results, null, 2));
await client.close();
