import { MongoClient } from 'mongodb';

async function checkUrl(url) {
  try {
    const resp = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000), redirect: 'follow' });
    return resp.status < 400;
  } catch {
    return false;
  }
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Find all books with archive.org or Harvard thumbnails
  const books = await db.collection('books').find({
    $or: [
      { thumbnail: { $regex: /archive\.org\/download/ } },
      { thumbnail: { $regex: /ids\.lib\.harvard\.edu/ } },
    ],
    pages_count: { $gt: 0 },
  }).project({ title: 1, thumbnail: 1, id: 1, _id: 0 }).toArray();

  console.log(`Checking ${books.length} external thumbnails in parallel batches...`);

  // Phase 1: Find broken URLs (parallel batches of 30)
  const brokenBooks = [];
  const BATCH = 30;
  for (let i = 0; i < books.length; i += BATCH) {
    const batch = books.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(b => checkUrl(b.thumbnail)));
    for (let j = 0; j < batch.length; j++) {
      if (!results[j]) brokenBooks.push(batch[j]);
    }
    if (i % 300 === 0) process.stdout.write(`  checked ${i + batch.length}/${books.length}, broken so far: ${brokenBooks.length}\n`);
  }

  console.log(`\nFound ${brokenBooks.length} broken thumbnails out of ${books.length}`);

  // Phase 2: Fix broken ones with local page images
  let fixed = 0;
  let noReplacement = 0;

  for (const book of brokenBooks) {
    let best = await db.collection('pages').findOne(
      { book_id: book.id, page_type: 'title-page' },
      { projection: { thumbnail_blob: 1, cropped_photo: 1, archived_photo: 1 } }
    );
    if (!best) {
      best = await db.collection('pages').findOne(
        { book_id: book.id, page_type: 'frontispiece' },
        { projection: { thumbnail_blob: 1, cropped_photo: 1, archived_photo: 1 } }
      );
    }
    if (!best) {
      best = await db.collection('pages').findOne(
        { book_id: book.id },
        { sort: { page_number: 1 }, skip: 1, projection: { thumbnail_blob: 1, cropped_photo: 1, archived_photo: 1 } }
      );
    }
    if (!best) {
      best = await db.collection('pages').findOne(
        { book_id: book.id },
        { sort: { page_number: 1 }, projection: { thumbnail_blob: 1, cropped_photo: 1, archived_photo: 1 } }
      );
    }

    const newUrl = best?.thumbnail_blob || best?.cropped_photo || best?.archived_photo;
    if (!newUrl) {
      noReplacement++;
      console.log(`  NO REPLACEMENT: ${book.title?.substring(0, 70)}`);
      continue;
    }

    await db.collection('books').updateOne({ id: book.id }, { $set: { thumbnail: newUrl } });
    fixed++;
  }

  console.log(`\nResults:`);
  console.log(`  Total checked: ${books.length}`);
  console.log(`  OK: ${books.length - brokenBooks.length}`);
  console.log(`  Broken: ${brokenBooks.length}`);
  console.log(`  Fixed: ${fixed}`);
  console.log(`  No replacement: ${noReplacement}`);

  await client.close();
}

main();
