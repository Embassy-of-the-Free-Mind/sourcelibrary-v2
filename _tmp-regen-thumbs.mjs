import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const bookId = '6984e84db96022f6fa69b4c8';

// Clear all thumbnail_blob values for this book
const result = await db.collection('pages').updateMany(
  { book_id: bookId },
  { $unset: { thumbnail_blob: '' } }
);

console.log(`Cleared thumbnail_blob from ${result.modifiedCount} pages`);
console.log('Now regenerate via: POST /api/books/6984e84db96022f6fa69b4c8/generate-thumbnails {"force": true}');
console.log('Or run: secret-lover run -- npx tsx scripts/thumbnails/generate-thumbnails-fast.ts --book-id=6984e84db96022f6fa69b4c8');

await client.close();
