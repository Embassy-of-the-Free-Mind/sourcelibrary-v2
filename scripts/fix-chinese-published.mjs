import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

const DRY_RUN = process.argv.includes('--dry-run');
console.log(DRY_RUN ? 'DRY RUN MODE' : 'LIVE MODE — will update database');

const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');

const books = await db.collection('books').find({
  language: 'Chinese',
  published: 'Unknown',
  ia_identifier: { $exists: true, $ne: null }
}).project({
  _id: 1,
  title: 1,
  ia_identifier: 1
}).toArray();

console.log(`Chinese books with published=Unknown and IA identifier: ${books.length}`);

// Batch fetch IA metadata (10 at a time to avoid rate limits)
const batchSize = 10;
let found = 0;
let updated = 0;
let noDate = 0;
const results = [];

for (let i = 0; i < books.length; i += batchSize) {
  const batch = books.slice(i, i + batchSize);
  const promises = batch.map(async (book) => {
    try {
      const resp = await fetch(
        `https://archive.org/metadata/${book.ia_identifier}/metadata`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!resp.ok) return { book, date: null, error: `HTTP ${resp.status}` };
      const meta = await resp.json();
      const r = meta?.result || {};
      // Try multiple date fields
      const date = r.date || r.year;
      return { book, date: date ? String(date) : null };
    } catch (e) {
      return { book, date: null, error: e.message };
    }
  });

  const batchResults = await Promise.all(promises);

  for (const { book, date, error } of batchResults) {
    if (date) {
      found++;
      // Extract just the year (4 digits) from the date string
      const yearMatch = date.match(/(\d{4})/);
      if (yearMatch) {
        const year = yearMatch[1];
        const yearNum = parseInt(year);
        results.push({ id: book._id, title: book.title, published: year, year: yearNum });

        if (!DRY_RUN) {
          await db.collection('books').updateOne(
            { _id: book._id },
            { $set: { published: year, year: yearNum } }
          );
          updated++;
        }
        if (found <= 20) {
          console.log(`  [${year}] ${(book.title || '').substring(0, 60)} (${book.ia_identifier})`);
        }
      }
    } else {
      noDate++;
    }
  }

  if ((i + batchSize) % 50 === 0 || i + batchSize >= books.length) {
    console.log(`  Progress: ${Math.min(i + batchSize, books.length)}/${books.length} checked, ${found} dates found`);
  }
}

console.log(`\nResults:`);
console.log(`  Total checked: ${books.length}`);
console.log(`  Dates found: ${found}`);
console.log(`  No date in IA: ${noDate}`);
if (!DRY_RUN) {
  console.log(`  Updated in DB: ${updated}`);
}

await client.close();
