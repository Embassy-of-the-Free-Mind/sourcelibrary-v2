import { config } from 'dotenv';
import { MongoClient } from 'mongodb';

config({ path: '.env.local' });

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB);

const pageId = process.argv[2];
if (!pageId) {
  console.error('Usage: node check-page.mjs <page-id>');
  process.exit(1);
}

const page = await db.collection('pages').findOne({ id: pageId });
if (!page) {
  console.error('Page not found');
  process.exit(1);
}

const book = await db.collection('books').findOne({ id: page.book_id });

console.log(`\nBook: ${book?.title}`);
console.log(`Page: ${page.page_number}`);
console.log(`\nImage URLs:`);
console.log(`  photo: ${page.photo || 'none'}`);
console.log(`  photo_original: ${page.photo_original || 'none'}`);
console.log(`  archived_photo: ${page.archived_photo || 'none'}`);
console.log(`  cropped_photo: ${page.cropped_photo || 'none'}`);
console.log(`  thumbnail: ${page.thumbnail || 'none'}`);
console.log(`\nCrop data:`);
console.log(`  crop: ${JSON.stringify(page.crop || {})}`);

await client.close();
