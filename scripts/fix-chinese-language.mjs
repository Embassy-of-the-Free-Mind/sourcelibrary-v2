import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

const client = new MongoClient(uri, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });
await client.connect();
const db = client.db('bookstore');

// Find all books with language Unknown that have CJK characters in title
const unknownBooks = await db.collection('books').find({
  language: 'Unknown',
  title: { $regex: '[\u4e00-\u9fff]' }
}).project({ id: 1, title: 1, ia_identifier: 1, language: 1, published: 1 }).toArray();

console.log(`Found ${unknownBooks.length} Chinese books with language: Unknown`);

if (unknownBooks.length === 0) {
  await client.close();
  process.exit(0);
}

// Fix language to Chinese
const bookResult = await db.collection('books').updateMany(
  { language: 'Unknown', title: { $regex: '[\u4e00-\u9fff]' } },
  { $set: { language: 'Chinese', updated_at: new Date() } }
);
console.log(`Updated ${bookResult.modifiedCount} books: language → Chinese`);

// Also fix the page-level ocr.language for these books
const bookIds = unknownBooks.map(b => b.id);
const pageResult = await db.collection('pages').updateMany(
  { book_id: { $in: bookIds }, 'ocr.language': 'Unknown' },
  { $set: { 'ocr.language': 'Chinese', updated_at: new Date() } }
);
console.log(`Updated ${pageResult.modifiedCount} pages: ocr.language → Chinese`);

// Show sample
for (const b of unknownBooks.slice(0, 5)) {
  console.log(`  ${b.title?.substring(0, 40)} | ${b.ia_identifier || 'no-ia'}`);
}
if (unknownBooks.length > 5) console.log(`  ... and ${unknownBooks.length - 5} more`);

await client.close();
