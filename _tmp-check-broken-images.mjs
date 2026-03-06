import { MongoClient } from 'mongodb';

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Get all books that would appear on collection pages (have collections, pages > 0, have thumbnails)
  const books = await db.collection('books').find({
    collections: { $exists: true, $ne: [] },
    pages_count: { $gt: 0 },
    thumbnail: { $exists: true, $ne: null, $ne: '' },
  }).project({ title: 1, thumbnail: 1, id: 1, _id: 0 }).toArray();

  console.log(`Testing ${books.length} book thumbnails...`);

  let broken = 0;
  let tested = 0;
  const batchSize = 20;

  for (let i = 0; i < books.length; i += batchSize) {
    const batch = books.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async (book) => {
        const resp = await fetch(book.thumbnail, {
          method: 'HEAD',
          signal: AbortSignal.timeout(10000),
          redirect: 'follow',
        });
        if (resp.status >= 400) {
          return { broken: true, status: resp.status, book };
        }
        return { broken: false };
      })
    );

    for (const r of results) {
      tested++;
      if (r.status === 'fulfilled' && r.value.broken) {
        broken++;
        const { status, book } = r.value;
        console.log(`BROKEN ${status} | ${book.title?.substring(0, 60)} | ${book.thumbnail?.substring(0, 80)}`);
      } else if (r.status === 'rejected') {
        broken++;
        const book = batch[results.indexOf(r)];
        console.log(`ERROR | ${book.title?.substring(0, 60)} | ${r.reason?.message?.substring(0, 50)}`);
      }
    }

    if (i % 200 === 0 && i > 0) {
      console.log(`  ...tested ${tested}, broken so far: ${broken}`);
    }
  }

  console.log(`\nDone. Tested: ${tested}, Broken: ${broken}`);
  await client.close();
}

main();
