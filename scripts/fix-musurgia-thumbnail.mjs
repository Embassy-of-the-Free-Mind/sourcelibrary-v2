import { config } from 'dotenv';
import { MongoClient } from 'mongodb';

config({ path: '.env.local' });

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB);

const bookId = '6952050fab34727b1f04216b';

// Get page 9's archived image (when actual content starts)
const firstPage = await db.collection('pages').findOne(
  { book_id: bookId, page_number: 9 }
);

if (!firstPage?.archived_photo) {
  console.error('No archived photo found for first page!');
  process.exit(1);
}

// Set book thumbnail to use the archived image through the proxy
const thumbnailUrl = `/api/image?url=${encodeURIComponent(firstPage.archived_photo)}&w=400&q=80`;

const result = await db.collection('books').updateOne(
  { id: bookId },
  {
    $set: {
      thumbnail: thumbnailUrl,
      updated_at: new Date()
    }
  }
);

console.log('Updated Musurgia universalis Tomus I thumbnail');
console.log('  Thumbnail URL:', thumbnailUrl);
console.log('  Modified count:', result.modifiedCount);

await client.close();
