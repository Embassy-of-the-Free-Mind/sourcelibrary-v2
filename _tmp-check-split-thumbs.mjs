import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

// Find books that have split pages (needs_splitting: true)
const splitBooks = await db.collection('books').find({
  needs_splitting: true,
  pages_count: { $gt: 0 }
}).project({ id: 1, title: 1, slug: 1, pages_count: 1 }).toArray();

console.log(`Found ${splitBooks.length} books with needs_splitting: true\n`);

let affectedCount = 0;
for (const book of splitBooks.slice(0, 20)) {
  // Get first 5 split pages for this book
  const pages = await db.collection('pages').find({
    book_id: book.id,
    'split_detection.isTwoPageSpread': true,
    thumbnail_blob: { $exists: true }
  }).sort({ page_number: 1 }).limit(5).toArray();

  if (pages.length === 0) continue;

  // Check if any thumbnail_blob doesn't match the page_number
  let hasMismatch = false;
  for (const p of pages) {
    const expectedSuffix = `/${p.page_number}.jpg`;
    if (p.thumbnail_blob && !p.thumbnail_blob.endsWith(expectedSuffix)) {
      hasMismatch = true;
      break;
    }
  }

  if (hasMismatch) {
    affectedCount++;
    console.log(`AFFECTED: ${book.title?.substring(0, 60)} (${book.pages_count} pages)`);
    for (const p of pages.slice(0, 3)) {
      const suffix = p.thumbnail_blob.split('/').pop();
      console.log(`  pg ${p.page_number}: thumbnail=${suffix} (expected ${p.page_number}.jpg)`);
    }
  }
}

console.log(`\nChecked ${Math.min(splitBooks.length, 20)} of ${splitBooks.length} split books`);
console.log(`${affectedCount} books have misaligned thumbnails`);

// Also count total pages with wrong thumbnails across ALL books
const pipeline = [
  { $match: { thumbnail_blob: { $exists: true }, 'split_detection.isTwoPageSpread': true } },
  { $project: {
    page_number: 1,
    thumbnail_blob: 1,
    expected_suffix: { $concat: ['/', { $toString: '$page_number' }, '.jpg'] },
    actual_suffix: { $substr: ['$thumbnail_blob', { $subtract: [{ $strLenCP: '$thumbnail_blob' }, 10] }, 10] }
  }},
  { $limit: 10000 }
];

// Simpler approach: count split pages with thumbnails
const splitPagesWithThumbs = await db.collection('pages').countDocuments({
  'split_detection.isTwoPageSpread': true,
  thumbnail_blob: { $exists: true, $ne: null }
});
console.log(`\nTotal split pages with thumbnail_blob: ${splitPagesWithThumbs}`);

await client.close();
