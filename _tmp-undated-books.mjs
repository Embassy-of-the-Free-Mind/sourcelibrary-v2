import { MongoClient } from 'mongodb';
const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');

const books = await db.collection('books').find(
  { year: null },
  { projection: { title: 1, author: 1, published: 1, language: 1, slug: 1 } }
).sort({ published: 1 }).toArray();

const byPub = {};
for (const b of books) {
  const p = b.published || '(empty)';
  if (!byPub[p]) byPub[p] = [];
  byPub[p].push(b);
}

for (const [pub, bks] of Object.entries(byPub).sort()) {
  console.log(`\n=== published: "${pub}" (${bks.length} books) ===`);
  for (const b of bks.slice(0, 5)) {
    console.log(`  ${(b.title||'').substring(0,65)} | ${b.author||'?'} | ${b.language||'?'}`);
    console.log(`    https://sourcelibrary.org/book/${b.slug}`);
  }
  if (bks.length > 5) console.log(`  ... and ${bks.length - 5} more`);
}

console.log(`\n\nTotal without year: ${books.length}`);
await client.close();
