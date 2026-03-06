import { MongoClient } from 'mongodb';
const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');

const langs = ["Greek","Hebrew","Arabic","Persian","Syriac","Chinese","Japanese","Armenian","Church Slavonic","Russian","Ottoman Turkish","Coptic"];
const books = await db.collection('books').find(
  { language: { $in: langs } },
  { projection: { id: 1, language: 1, pages_ocr: 1 } }
).toArray();

const byLang = {};
let total = 0;
for (const b of books) {
  const l = b.language;
  if (!byLang[l]) byLang[l] = { n: 0, p: 0 };
  byLang[l].n++;
  byLang[l].p += (b.pages_ocr || 0);
}
Object.entries(byLang).sort((a, b) => b[1].p - a[1].p).forEach(([l, d]) => {
  console.log(`${l}: ${d.n} books, ${d.p} pages`);
  total += d.p;
});

const done = await db.collection('pages').countDocuments({
  'transliteration.data': { $exists: true, $ne: '' }
});

console.log('---');
console.log(`Total non-Latin-script pages with OCR: ${total}`);
console.log(`Already transliterated: ${done}`);
console.log(`Remaining: ${total - done}`);
console.log(`\nCost to do ALL ${total} pages:`);
console.log(`  gemini-3-flash-preview: $${(total * 0.0067).toFixed(2)}`);
console.log(`  gemini-2.5-flash:       $${(total * 0.0013).toFixed(2)}`);
console.log(`  deterministic (code):   $0.00`);

await client.close();
