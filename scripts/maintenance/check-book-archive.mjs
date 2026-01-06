import { config } from 'dotenv';
import { MongoClient } from 'mongodb';

config({ path: '.env.local' });

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB);

const bookId = process.argv[2];
if (!bookId) {
  console.error('Usage: node check-book-archive.mjs <book-id>');
  process.exit(1);
}

const book = await db.collection('books').findOne({ id: bookId });
if (!book) {
  console.error('Book not found');
  process.exit(1);
}

console.log(`\n${book.title} by ${book.author}`);
console.log(`  Book ID: ${book.id}`);

const totalPages = await db.collection('pages').countDocuments({ book_id: book.id });
const archivedPages = await db.collection('pages').countDocuments({
  book_id: book.id,
  archived_photo: { $exists: true, $ne: null, $ne: '' }
});

console.log(`  Pages: ${archivedPages}/${totalPages} archived (${((archivedPages/totalPages)*100).toFixed(1)}%)`);

// Check photo source
const samplePage = await db.collection('pages').findOne({ book_id: book.id });
if (samplePage?.photo) {
  const isIIIF = /digi.vatlib|gallica|bodleian|digitale-sammlungen|iiif/i.test(samplePage.photo);
  const isIA = samplePage.photo.includes('archive.org');
  console.log(`  Source: ${isIIIF ? 'IIIF' : isIA ? 'Internet Archive' : 'Other'}`);
}

await client.close();
