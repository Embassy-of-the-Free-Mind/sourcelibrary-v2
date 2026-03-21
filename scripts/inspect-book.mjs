import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');

// Get a complete book document
const book = await books.findOne({
  slug: 'complete-plato-thomas-taylor-trans-plato-taylor',
  hidden: { $ne: true }
});

if (book) {
  console.log('=== COMPLETE BOOK RECORD ===\n');
  console.log(JSON.stringify(book, null, 2));
  console.log('\n=== FIELD SUMMARY ===');
  console.log('Has source_url:', book.source_url ? 'YES' : 'NO');
  console.log('Has ia_id:', book.ia_id ? 'YES' : 'NO');
  console.log('Has import_source:', book.import_source ? 'YES' : 'NO');
  console.log('Has pages_count:', book.pages_count);
  console.log('Has thumbnail:', book.thumbnail ? 'YES' : 'NO');
  console.log('Has description:', book.description ? `YES (${book.description.length} chars)` : 'NO');
  console.log('Other interesting fields:', Object.keys(book).filter(k => !k.startsWith('_')).join(', '));
} else {
  console.log('Book not found');
}

await client.close();
