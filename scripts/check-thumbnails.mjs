import { config } from 'dotenv';
import { MongoClient } from 'mongodb';

config({ path: '.env.local' });

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB);

const bookId = process.argv[2];
if (!bookId) {
  console.error('Usage: node check-thumbnails.mjs <book-id>');
  process.exit(1);
}

const book = await db.collection('books').findOne({ id: bookId });
console.log(`\n${book.title}`);

// Check first 5 pages
const pages = await db.collection('pages')
  .find({ book_id: bookId })
  .sort({ page_number: 1 })
  .limit(5)
  .toArray();

console.log(`\nFirst 5 pages:`);
for (const page of pages) {
  console.log(`\nPage ${page.page_number}:`);
  console.log(`  thumbnail: ${page.thumbnail?.substring(0, 100) || 'none'}...`);
  console.log(`  photo: ${page.photo?.substring(0, 100) || 'none'}...`);
  console.log(`  archived_photo: ${page.archived_photo?.substring(0, 100) || 'none'}...`);
}

await client.close();
