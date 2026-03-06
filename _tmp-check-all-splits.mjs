import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const splitBooks = await db.collection('books').find({
  needs_splitting: true,
  pages_count: { $gt: 0 }
}).project({ id: 1, title: 1, slug: 1, pages_count: 1 }).toArray();

console.log(`Total split books: ${splitBooks.length}\n`);

const affected = [];

for (const book of splitBooks) {
  const pages = await db.collection('pages').find({
    book_id: book.id,
    'split_detection.isTwoPageSpread': true,
    thumbnail_blob: { $exists: true, $ne: null }
  }).sort({ page_number: 1 }).limit(5).toArray();

  if (pages.length === 0) continue;

  let hasMismatch = false;
  for (const p of pages) {
    const expected = '/' + p.page_number + '.jpg';
    if (p.thumbnail_blob && !p.thumbnail_blob.endsWith(expected)) {
      hasMismatch = true;
      break;
    }
  }

  if (hasMismatch) {
    affected.push({
      title: (book.title || '').substring(0, 60),
      slug: book.slug,
      pages: book.pages_count
    });
  }
}

console.log(`Affected: ${affected.length}\n`);
for (const b of affected) {
  console.log(`  ${b.title} (${b.pages} pages)`);
  console.log(`  https://sourcelibrary.org/book/${b.slug}`);
}

await client.close();
