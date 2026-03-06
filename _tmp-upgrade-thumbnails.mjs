#!/usr/bin/env node
/**
 * Upgrade book thumbnails using OCR page_type metadata.
 *
 * Priority: frontispiece > title-page > first illustration (within first 30 pages)
 *
 * Only upgrades if the current thumbnail points to a boring page (blank, text, cover).
 * Skips books where thumbnail was manually picked (CoverImagePicker sets a flag... actually no flag).
 *
 * Strategy: For each book, check if we can find a better page than what's currently used.
 * We compare the current thumbnail URL against page URLs to find which page it is,
 * then check if there's a better candidate.
 *
 * Usage:
 *   node _tmp-upgrade-thumbnails.mjs --dry-run     # preview changes
 *   node _tmp-upgrade-thumbnails.mjs               # apply changes
 *   node _tmp-upgrade-thumbnails.mjs --limit=50    # process 50 books
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI required'); process.exit(1); }

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitArg = args.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1]) : 0;

// Page types that make good covers, in priority order
const GOOD_COVER_TYPES = ['frontispiece', 'title-page'];
// Page types that are visually interesting but lower priority
const INTERESTING_TYPES = ['illustration'];
// Page types that are BAD covers
const BORING_TYPES = ['blank', 'text', 'toc', 'index', 'errata', 'colophon', 'appendix', 'preface', 'dedication'];

async function run() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Get all books
  // Skip manually-picked covers
  const bookQuery = {
    thumbnail: { $exists: true, $ne: null },
    thumbnail_source: { $ne: 'manual' },
  };
  const totalBooks = await db.collection('books').countDocuments(bookQuery);
  console.log(`Total eligible books (excluding manual): ${totalBooks}`);

  const cursor = db.collection('books').find(bookQuery, {
    projection: { id: 1, title: 1, thumbnail: 1, thumbnail_blob: 1, thumbnail_source: 1 },
    sort: { read_count: -1 }, // Most-read books first
  });
  if (limit) cursor.limit(limit);

  let upgraded = 0;
  let skipped = 0;
  let alreadyGood = 0;
  let noCandidate = 0;
  let processed = 0;

  for await (const book of cursor) {
    processed++;
    if (processed % 200 === 0) {
      console.log(`Progress: ${processed}/${limit || totalBooks} (upgraded: ${upgraded}, skipped: ${skipped})`);
    }

    // Find which page the current thumbnail belongs to
    const currentThumbUrl = book.thumbnail;

    // Find the current thumbnail page by matching URLs
    const currentPage = await db.collection('pages').findOne({
      book_id: book.id,
      $or: [
        { cropped_photo: currentThumbUrl },
        { archived_photo: currentThumbUrl },
        { photo: currentThumbUrl },
        { photo_original: currentThumbUrl },
        { thumbnail_blob: currentThumbUrl },
      ]
    }, { projection: { page_number: 1, page_type: 1 } });

    const currentPageType = currentPage?.page_type;
    const currentPageNum = currentPage?.page_number;

    // If current thumbnail is already a frontispiece or title-page, skip
    if (currentPageType === 'frontispiece') {
      alreadyGood++;
      continue;
    }
    if (currentPageType === 'title-page') {
      // Only upgrade title-page if there's a frontispiece available
      const frontispiece = await db.collection('pages').findOne({
        book_id: book.id,
        page_type: 'frontispiece',
      }, { projection: { page_number: 1 } });
      if (!frontispiece) {
        alreadyGood++;
        continue;
      }
    }

    // Find the best candidate page
    const pageProjection = { page_number: 1, page_type: 1, cropped_photo: 1, archived_photo: 1, photo: 1, photo_original: 1, thumbnail_blob: 1 };

    // Priority 1: frontispiece (within first 50 pages — later ones are likely misclassified or multi-volume)
    let bestPage = await db.collection('pages').findOne({
      book_id: book.id,
      page_type: 'frontispiece',
      page_number: { $lte: 50 },
    }, { projection: pageProjection, sort: { page_number: 1 } });

    // Priority 2: title-page (within first 30 pages)
    if (!bestPage) {
      bestPage = await db.collection('pages').findOne({
        book_id: book.id,
        page_type: 'title-page',
        page_number: { $lte: 30 },
      }, { projection: pageProjection, sort: { page_number: 1 } });
    }

    // Priority 3: first illustration within first 20 pages
    if (!bestPage) {
      bestPage = await db.collection('pages').findOne({
        book_id: book.id,
        page_type: 'illustration',
        page_number: { $lte: 20 },
      }, { projection: pageProjection, sort: { page_number: 1 } });
    }

    if (!bestPage) {
      noCandidate++;
      continue;
    }

    // Get the best URL for this page
    const newThumbUrl = bestPage.cropped_photo || bestPage.archived_photo || bestPage.photo || bestPage.photo_original;
    if (!newThumbUrl) {
      noCandidate++;
      continue;
    }

    // Don't "upgrade" if it's the same page
    if (newThumbUrl === currentThumbUrl) {
      alreadyGood++;
      continue;
    }

    // Skip if the current page type is already title-page and we'd switch to title-page
    if (currentPageType === 'title-page' && bestPage.page_type === 'title-page') {
      alreadyGood++;
      continue;
    }

    if (dryRun) {
      console.log(`WOULD UPGRADE: "${book.title?.substring(0, 60)}" — page ${currentPageNum || '?'} (${currentPageType || 'unknown'}) → page ${bestPage.page_number} (${bestPage.page_type})`);
    } else {
      const update = { thumbnail: newThumbUrl, thumbnail_source: 'auto' };
      if (bestPage.thumbnail_blob) update.thumbnail_blob = bestPage.thumbnail_blob;
      await db.collection('books').updateOne({ id: book.id }, { $set: update });
    }
    upgraded++;
  }

  console.log('\n--- Results ---');
  console.log(`Processed: ${processed}`);
  console.log(`Upgraded: ${upgraded}${dryRun ? ' (dry run)' : ''}`);
  console.log(`Already good: ${alreadyGood}`);
  console.log(`No better candidate: ${noCandidate}`);
  console.log(`Skipped: ${skipped}`);

  await client.close();
}

run().catch(e => { console.error(e); process.exit(1); });
