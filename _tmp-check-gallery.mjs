import dotenv from 'dotenv';
dotenv.config({ path: '.env.production.local' });

import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);

async function main() {
  await client.connect();
  const db = client.db('bookstore');

  // Find books matching common SHWEP-relevant topics
  const searchTerms = ['Hermes Trismegistus', 'Plotinus', 'Ficino', 'Corpus Hermeticum', 'Neoplatonism'];

  console.log('--- Finding SHWEP-relevant books ---\n');

  const books = await db.collection('books').find({
    $or: [
      { title: { $regex: searchTerms.join('|'), $options: 'i' } },
      { author: { $regex: searchTerms.join('|'), $options: 'i' } },
      { 'reading_summary.overview': { $regex: searchTerms.join('|'), $options: 'i' } }
    ]
  }, {
    projection: { _id: 0, id: 1, title: 1, author: 1, slug: 1 }
  }).limit(10).toArray();

  console.log(`Found ${books.length} SHWEP-relevant books:\n`);
  for (const b of books) {
    console.log(`  ${b.id} - ${b.title} (${b.author || 'unknown'})`);
  }

  const bookIds = books.map(b => b.id);

  // Check gallery_images collection
  console.log('\n--- Checking gallery_images collection ---\n');

  const totalGallery = await db.collection('gallery_images').countDocuments();
  console.log(`Total gallery_images documents: ${totalGallery}`);

  if (bookIds.length === 0) {
    console.log('No book IDs to query');
    await client.close();
    return;
  }

  const matchingImages = await db.collection('gallery_images').find({
    book_id: { $in: bookIds },
    gallery_quality: { $gte: 0.8 }
  }, {
    projection: { _id: 0, book_id: 1, gallery_quality: 1, cropped_url: 1, description: 1, type: 1, page_number: 1 }
  }).toArray();

  console.log(`Gallery images for SHWEP books (quality >= 0.8): ${matchingImages.length}\n`);

  // Group by book
  const byBook = {};
  for (const img of matchingImages) {
    if (!byBook[img.book_id]) byBook[img.book_id] = [];
    byBook[img.book_id].push(img);
  }

  for (const [bookId, images] of Object.entries(byBook)) {
    const book = books.find(b => b.id === bookId);
    const bookTitle = book ? book.title : bookId;
    console.log(`\n  ${bookTitle} (${images.length} images):`);
    for (const img of images.slice(0, 3)) {
      const quality = img.gallery_quality ? img.gallery_quality.toFixed(2) : 'n/a';
      const desc = img.description ? img.description.substring(0, 80) : 'no description';
      console.log(`    - [q=${quality}] ${img.type || 'unknown'}: ${desc}`);
      if (img.cropped_url) {
        console.log(`      URL: ${img.cropped_url}`);
      }
    }
    if (images.length > 3) {
      console.log(`    ... and ${images.length - 3} more`);
    }
  }

  // Also check: how many total books have gallery images?
  const booksWithImages = await db.collection('gallery_images').distinct('book_id');
  console.log(`\n--- Summary ---`);
  console.log(`Total books with gallery images: ${booksWithImages.length}`);
  console.log(`SHWEP-relevant books checked: ${bookIds.length}`);
  console.log(`SHWEP books with quality images: ${Object.keys(byBook).length}`);

  await client.close();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
