import { config } from 'dotenv';
import { MongoClient } from 'mongodb';

config({ path: '.env.local' });

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB);

// Find Musurgia universalis books
const books = await db.collection('books')
  .find({
    title: { $regex: 'Musurgia.*universalis.*I', $options: 'i' }
  })
  .project({ id: 1, title: 1, author: 1, ia_identifier: 1 })
  .toArray();

console.log('Found books:');
for (const book of books) {
  console.log(`\n${book.title} by ${book.author}`);
  console.log(`  Book ID: ${book.id}`);
  console.log(`  IA ID: ${book.ia_identifier || 'none'}`);

  // Check archive status
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
}

await client.close();
