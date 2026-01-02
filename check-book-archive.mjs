import { config } from 'dotenv';
import { MongoClient } from 'mongodb';

config({ path: '.env.prod' });
config({ path: '.env.local', override: true });

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB);

// Find the book
const book = await db.collection('books').findOne({
  title: { $regex: 'Musurgia universalis.*Tomus I', $options: 'i' }
});

if (!book) {
  console.log('Book not found');
  await client.close();
  process.exit(0);
}

console.log('Found: ' + book.title);
console.log('Book ID: ' + (book.id || book._id));

// Check pages
const bookId = book.id || book._id.toString();
const totalPages = await db.collection('pages').countDocuments({ book_id: bookId });
const archivedPages = await db.collection('pages').countDocuments({
  book_id: bookId,
  archived_photo: { $exists: true, $ne: null, $ne: '' }
});

console.log(`Pages: ${archivedPages}/${totalPages} archived`);

// Show sample
const sample = await db.collection('pages').findOne(
  { book_id: bookId },
  { projection: { photo: 1, archived_photo: 1, page_number: 1 } }
);

if (sample) {
  console.log('\nSample page #' + sample.page_number + ':');
  console.log('  Original: ' + (sample.photo?.substring(0, 70) || 'none') + '...');
  console.log('  Archived: ' + (sample.archived_photo?.substring(0, 70) || 'none') + '...');
}

await client.close();
