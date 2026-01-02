import { config } from 'dotenv';
import { MongoClient } from 'mongodb';

config({ path: '.env.local' });

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB);

const bookId = '676578c2bda54ffa65999288';

// Get first page
const firstPage = await db.collection('pages').findOne(
  { book_id: bookId },
  { sort: { page_number: 1 } }
);

console.log('First page thumbnail:', firstPage?.thumbnail);

// Use the correctly-oriented S3 thumbnail through the proxy
const thumbnailUrl = `/api/image?url=${encodeURIComponent(firstPage.thumbnail)}&w=400&q=80`;

const result = await db.collection('books').updateOne(
  { id: bookId },
  {
    $set: {
      thumbnail: thumbnailUrl,
      updated_at: new Date()
    }
  }
);

console.log('Updated book thumbnail to use S3 thumbnail (correctly oriented)');
console.log('  New thumbnail:', thumbnailUrl);
console.log('  Modified:', result.modifiedCount);

await client.close();
