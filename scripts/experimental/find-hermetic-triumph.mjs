import { config } from 'dotenv';
import { MongoClient } from 'mongodb';

config({ path: '.env.prod' });
config({ path: '.env.local', override: true });

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB);

// Search for variations of The Hermetic Triumph
const patterns = [
  'Hermetical Triumph',
  'Hermetic Triumph',
  'Victorious Philosopher',
  'Limojon',
  'Saint-Didier'
];

console.log('Searching for The Hermetical Triumph...\n');

for (const pattern of patterns) {
  const books = await db.collection('books').find({
    $or: [
      { title: { $regex: pattern, $options: 'i' } },
      { author: { $regex: pattern, $options: 'i' } }
    ]
  }).toArray();

  if (books.length > 0) {
    console.log(`\nMatches for "${pattern}":`);
    for (const book of books) {
      const bookId = book.id || book._id.toString();
      const pageCount = await db.collection('pages').countDocuments({ book_id: bookId });
      const archivedCount = await db.collection('pages').countDocuments({
        book_id: bookId,
        archived_photo: { $exists: true, $ne: null, $ne: '' }
      });
      console.log(`  Title: ${book.title}`);
      console.log(`  Author: ${book.author || 'Unknown'}`);
      console.log(`  Book ID: ${bookId}`);
      console.log(`  Pages: ${archivedCount}/${pageCount} archived`);
      console.log();
    }
  }
}

await client.close();
