import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');

// Find books with NO source info across all nested fields
const trueShells = await books.find({
  hidden: { $ne: true },
  $and: [
    { source_url: { $exists: false } },
    { ia_id: { $exists: false } },
    { ia_identifier: { $exists: false } },
    { 'image_source.source_url': { $exists: false } },
    { 'dublin_core.dc_source': { $exists: false } }
  ]
}).project({
  title: 1,
  slug: 1,
  pages_count: 1,
  id: 1,
  language: 1,
  pages_ocr: 1,
  pages_translated: 1
}).limit(20).toArray();

console.log(`Found ${trueShells.length} books with absolutely no source information\n`);

for (const book of trueShells) {
  console.log(`Title: ${book.title}`);
  console.log(`Slug: ${book.slug}`);
  console.log(`Pages: ${book.pages_count} (OCR: ${book.pages_ocr}, Translated: ${book.pages_translated})`);
  console.log('');
}

// Also check the distribution
const withImageSource = await books.countDocuments({
  hidden: { $ne: true },
  'image_source.source_url': { $exists: true }
});

const withIaId = await books.countDocuments({
  hidden: { $ne: true },
  ia_identifier: { $exists: true }
});

const withDublin = await books.countDocuments({
  hidden: { $ne: true },
  'dublin_core.dc_source': { $exists: true }
});

const total = await books.countDocuments({ hidden: { $ne: true } });

console.log(`=== SOURCE DISTRIBUTION ===`);
console.log(`Total non-hidden: ${total}`);
console.log(`With image_source.source_url: ${withImageSource}`);
console.log(`With ia_identifier: ${withIaId}`);
console.log(`With dublin_core.dc_source: ${withDublin}`);
console.log(`With none of the above: ${total - Math.max(withImageSource, withIaId, withDublin)}`);

await client.close();
