import { config } from 'dotenv';
import { MongoClient } from 'mongodb';

config({ path: '.env.local' });

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB);

const bookId = process.argv[2];
if (!bookId) {
  console.error('Usage: node check-poster.mjs <book-id>');
  process.exit(1);
}

const book = await db.collection('books').findOne({ id: bookId });
console.log('Book poster field:', book.poster || 'NO POSTER');

// Check first page
const firstPage = await db.collection('pages').findOne(
  { book_id: bookId },
  { sort: { page_number: 1 } }
);

console.log('\nFirst page:');
console.log('  page_number:', firstPage?.page_number);
console.log('  photo:', firstPage?.photo?.substring(0, 100) + '...');
console.log('  archived_photo:', firstPage?.archived_photo?.substring(0, 100) + '...');

await client.close();
