import { config } from 'dotenv';
import { MongoClient } from 'mongodb';

config({ path: '.env.local' });

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB);

const bookId = '676578c2bda54ffa65999288';

const book = await db.collection('books').findOne({ id: bookId });
console.log(`\n${book.title}`);
console.log(`  Poster: ${book.thumbnail || 'none'}`);

const pages = await db.collection('pages')
  .find({ book_id: bookId })
  .sort({ page_number: 1 })
  .limit(5)
  .toArray();

console.log(`\nPages (${pages.length}):`);
for (const page of pages) {
  console.log(`\nPage ${page.page_number}:`);
  console.log(`  photo: ${page.photo?.substring(0, 80)}...`);
  console.log(`  thumbnail: ${page.thumbnail?.substring(0, 80)}...`);
  console.log(`  orientation: ${page.orientation || 'none'}`);
  console.log(`  rotation: ${page.rotation || 'none'}`);
  console.log(`  metadata:`, JSON.stringify(page.metadata || {}, null, 2));
}

await client.close();
