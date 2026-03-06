import { MongoClient } from 'mongodb';
import { execSync } from 'child_process';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

// Find all affected books (same query as before)
const splitBooks = await db.collection('books').find({
  needs_splitting: true,
  pages_count: { $gt: 0 }
}).project({ id: 1, title: 1, slug: 1, pages_count: 1 }).toArray();

const affected = [];

for (const book of splitBooks) {
  const pages = await db.collection('pages').find({
    book_id: book.id,
    'split_detection.isTwoPageSpread': true,
    thumbnail_blob: { $exists: true, $ne: null }
  }).sort({ page_number: 1 }).limit(5).toArray();

  if (pages.length === 0) continue;

  for (const p of pages) {
    const expected = '/' + p.page_number + '.jpg';
    if (p.thumbnail_blob && !p.thumbnail_blob.endsWith(expected)) {
      affected.push(book);
      break;
    }
  }
}

console.log(`Remaining affected books: ${affected.length}`);
const totalPages = affected.reduce((sum, b) => sum + b.pages_count, 0);
console.log(`Total pages: ${totalPages}\n`);

let done = 0;
let failed = 0;

for (const book of affected) {
  done++;
  console.log(`[${done}/${affected.length}] ${book.title?.substring(0, 50)} (${book.pages_count} pages)`);

  const cleared = await db.collection('pages').updateMany(
    { book_id: book.id },
    { $unset: { thumbnail_blob: '' } }
  );

  try {
    execSync(
      `npx tsx scripts/thumbnails/generate-thumbnails-fast.ts --book-id=${book.id}`,
      { timeout: 600000, stdio: 'pipe' }
    );
    console.log(`  OK (cleared ${cleared.modifiedCount})`);
  } catch (err) {
    failed++;
    const output = err.stdout?.toString() || err.stderr?.toString() || '';
    const summary = output.split('\n').find(l => l.startsWith('Done in')) || 'error';
    console.log(`  PARTIAL: ${summary}`);
  }
}

console.log(`\nFinished: ${done - failed} ok, ${failed} had errors`);
await client.close();
