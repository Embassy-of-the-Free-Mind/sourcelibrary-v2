#!/usr/bin/env node
/**
 * Mark all books with non-page-1 thumbnails as thumbnail_source: 'manual'.
 * This preserves manually-picked covers so the auto-upgrade function won't override them.
 *
 * Also marks books that already have thumbnail_source set as 'auto' if their thumbnail
 * was upgraded by our script (matches a frontispiece/title-page).
 */
import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI required'); process.exit(1); }

const dryRun = process.argv.includes('--dry-run');

async function run() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Find ALL books with thumbnails that don't already have thumbnail_source set
  const books = await db.collection('books').find(
    {
      thumbnail: { $exists: true, $ne: null },
      thumbnail_source: { $exists: false },
    },
    { projection: { id: 1, title: 1, thumbnail: 1 } }
  ).toArray();

  console.log(`Books without thumbnail_source: ${books.length}`);

  let markedManual = 0;
  let markedAuto = 0;
  let noPage1 = 0;

  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    if (i > 0 && i % 500 === 0) {
      console.log(`Progress: ${i}/${books.length} (manual: ${markedManual}, auto: ${markedAuto})`);
    }

    // Get page 1
    const page1 = await db.collection('pages').findOne(
      { book_id: book.id, page_number: 1 },
      { projection: { cropped_photo: 1, archived_photo: 1, photo: 1, photo_original: 1 } }
    );

    if (!page1) {
      noPage1++;
      continue;
    }

    const page1Urls = [page1.cropped_photo, page1.archived_photo, page1.photo, page1.photo_original].filter(Boolean);

    if (page1Urls.includes(book.thumbnail)) {
      // Thumbnail IS page 1 — mark as auto (import default)
      if (!dryRun) {
        await db.collection('books').updateOne({ id: book.id }, { $set: { thumbnail_source: 'auto' } });
      }
      markedAuto++;
    } else {
      // Thumbnail is NOT page 1 — could be manual pick or our script's upgrade.
      // Mark as manual to be safe (protects human choices).
      if (!dryRun) {
        await db.collection('books').updateOne({ id: book.id }, { $set: { thumbnail_source: 'manual' } });
      }
      markedManual++;
    }
  }

  console.log('\n--- Results ---');
  console.log(`Processed: ${books.length}`);
  console.log(`Marked auto (page 1): ${markedAuto}${dryRun ? ' (dry run)' : ''}`);
  console.log(`Marked manual (non-page-1): ${markedManual}${dryRun ? ' (dry run)' : ''}`);
  console.log(`No page 1: ${noPage1}`);

  await client.close();
}

run().catch(e => { console.error(e); process.exit(1); });
