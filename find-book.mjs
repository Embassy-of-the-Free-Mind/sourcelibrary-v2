import { config } from 'dotenv';
import { MongoClient } from 'mongodb';

config({ path: '.env.prod' });
config({ path: '.env.local', override: true });

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB);

// Find books matching "hermetic triumph"
const books = await db.collection('books').find({
  title: { $regex: 'hermetic.*triumph|triumph.*hermetic', $options: 'i' }
}).toArray();

if (books.length === 0) {
  console.log('No exact match. Searching for "hermetic" or "triumph" separately...\n');

  const hermeticBooks = await db.collection('books')
    .find({ title: { $regex: 'hermetic', $options: 'i' } })
    .limit(20)
    .toArray();

  if (hermeticBooks.length > 0) {
    console.log('Books with "hermetic" in title:');
    for (const book of hermeticBooks) {
      const pageCount = await db.collection('pages').countDocuments({ book_id: book.id || book._id.toString() });
      const archivedCount = await db.collection('pages').countDocuments({
        book_id: book.id || book._id.toString(),
        archived_photo: { $exists: true, $ne: null, $ne: '' }
      });
      console.log(`  ${book.title} (${archivedCount}/${pageCount} archived)`);
    }
  }

  const triumphBooks = await db.collection('books')
    .find({ title: { $regex: 'triumph', $options: 'i' } })
    .limit(20)
    .toArray();

  if (triumphBooks.length > 0) {
    console.log('\nBooks with "triumph" in title:');
    for (const book of triumphBooks) {
      const pageCount = await db.collection('pages').countDocuments({ book_id: book.id || book._id.toString() });
      const archivedCount = await db.collection('pages').countDocuments({
        book_id: book.id || book._id.toString(),
        archived_photo: { $exists: true, $ne: null, $ne: '' }
      });
      console.log(`  ${book.title} (${archivedCount}/${pageCount} archived)`);
    }
  }
} else {
  console.log('Found matches:\n');
  for (const book of books) {
    const bookId = book.id || book._id.toString();
    const pageCount = await db.collection('pages').countDocuments({ book_id: bookId });
    const archivedCount = await db.collection('pages').countDocuments({
      book_id: bookId,
      archived_photo: { $exists: true, $ne: null, $ne: '' }
    });
    console.log(`Title: ${book.title}`);
    console.log(`Book ID: ${bookId}`);
    console.log(`Pages: ${archivedCount}/${pageCount} archived`);
    console.log();
  }
}

await client.close();
