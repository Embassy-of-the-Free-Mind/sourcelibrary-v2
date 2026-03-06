#!/usr/bin/env node
/**
 * Find books where thumbnail is NOT page 1, and mark them as thumbnail_source: 'manual'.
 * These are books where someone intentionally picked a different cover.
 *
 * Usage:
 *   node _tmp-find-manual-covers.mjs --dry-run    # preview
 *   node _tmp-find-manual-covers.mjs              # apply
 */
import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI required'); process.exit(1); }

const dryRun = process.argv.includes('--dry-run');

async function run() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const books = await db.collection('books').find(
    { thumbnail: { $exists: true, $ne: null } },
    { projection: { id: 1, title: 1, thumbnail: 1, thumbnail_source: 1 } }
  ).toArray();

  console.log(`Checking ${books.length} books...`);

  let manualCount = 0;
  let page1Count = 0;
  let noPage1 = 0;
  let alreadyManual = 0;
  let noMatch = 0;

  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    if (i > 0 && i % 500 === 0) {
      console.log(`Progress: ${i}/${books.length} (manual: ${manualCount})`);
    }

    // Already marked
    if (book.thumbnail_source === 'manual') {
      alreadyManual++;
      continue;
    }

    // Get page 1
    const page1 = await db.collection('pages').findOne(
      { book_id: book.id, page_number: 1 },
      { projection: { cropped_photo: 1, archived_photo: 1, photo: 1, photo_original: 1, thumbnail_blob: 1 } }
    );

    if (!page1) {
      noPage1++;
      continue;
    }

    const page1Urls = [
      page1.cropped_photo, page1.archived_photo, page1.photo, page1.photo_original, page1.thumbnail_blob
    ].filter(Boolean);

    if (page1Urls.includes(book.thumbnail)) {
      page1Count++;
      continue;
    }

    // Thumbnail doesn't match page 1 — check if it matches ANY other page
    const matchingPage = await db.collection('pages').findOne({
      book_id: book.id,
      $or: [
        { cropped_photo: book.thumbnail },
        { archived_photo: book.thumbnail },
        { photo: book.thumbnail },
        { photo_original: book.thumbnail },
      ]
    }, { projection: { page_number: 1, page_type: 1 } });

    if (!matchingPage) {
      // Thumbnail URL doesn't match any page — could be blob thumbnail or old URL
      // These are ambiguous, skip them
      noMatch++;
      continue;
    }

    // It's a non-page-1 cover — mark as manual
    if (dryRun) {
      console.log(`MANUAL: "${book.title?.substring(0, 55)}" — page ${matchingPage.page_number} (${matchingPage.page_type || '?'})`);
    } else {
      await db.collection('books').updateOne(
        { id: book.id },
        { $set: { thumbnail_source: 'manual' } }
      );
    }
    manualCount++;
  }

  console.log('\n--- Results ---');
  console.log(`Total checked: ${books.length}`);
  console.log(`Page 1 thumbnails: ${page1Count}`);
  console.log(`Manual picks found: ${manualCount}${dryRun ? ' (dry run)' : ' (marked)'}`);
  console.log(`Already marked manual: ${alreadyManual}`);
  console.log(`No page 1: ${noPage1}`);
  console.log(`No URL match: ${noMatch}`);

  await client.close();
}

run().catch(e => { console.error(e); process.exit(1); });
