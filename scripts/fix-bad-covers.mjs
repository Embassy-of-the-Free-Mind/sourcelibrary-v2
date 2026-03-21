#!/usr/bin/env node
/**
 * Find books with bad covers (digitizer inserts, library stamps, barcodes,
 * plain text pages, blank pages) and upgrade to title pages or frontispieces.
 *
 * Usage:
 *   DRY_RUN=1 node scripts/fix-bad-covers.mjs          # preview changes
 *   node scripts/fix-bad-covers.mjs                      # apply fixes
 *   COLLECTION=islam node scripts/fix-bad-covers.mjs     # single collection
 */

import { MongoClient } from 'mongodb';

const DRY_RUN = process.env.DRY_RUN === '1';
const COLLECTION_FILTER = process.env.COLLECTION || null;

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

// Patterns that indicate a bad cover page (checked against OCR text)
const BAD_COVER_PATTERNS = [
  /internet\s+archive/i,
  /digitized\s+by\s+google/i,
  /google\s+logo/i,
  /digitization\s+credit/i,
  /inserted\s+by\s+the\s+internet/i,
  /library\s+of\s+the\s+university/i,
  /digital\s+library/i,
  /california\s+digital/i,
  /barcode/i,
  /ex[\s\-.]?libris/i,
  /bookplate/i,
  /philosophia\s+hermetica/i,
  /bibliotheca\s+philosophica/i,
];

function isBadCoverOcr(ocrText) {
  if (!ocrText) return false;
  const start = ocrText.substring(0, 1500);
  return BAD_COVER_PATTERNS.some(p => p.test(start));
}

// Bad page types for covers
const BAD_PAGE_TYPES = new Set(['blank', 'digitizer-insert', 'text', 'toc', 'index', 'errata', 'appendix']);

// Get books — optionally filtered by collection
let bookFilter = { hidden: { $ne: true } };
if (COLLECTION_FILTER) {
  bookFilter.collections = COLLECTION_FILTER;
  console.log(`Filtering to collection: ${COLLECTION_FILTER}`);
}

const books = await db.collection('books').find(
  { ...bookFilter, thumbnail: { $exists: true, $ne: '' } },
  { projection: { id: 1, title: 1, thumbnail: 1, thumbnail_blob: 1, thumbnail_source: 1, slug: 1 } }
).toArray();

console.log(`Checking ${books.length} books...`);
if (DRY_RUN) console.log('DRY RUN — no changes will be made\n');

let fixed = 0;
let skipped = 0;
let alreadyGood = 0;

for (const book of books) {
  // Skip manually-set thumbnails
  if (book.thumbnail_source === 'manual') {
    skipped++;
    continue;
  }

  // Find which page the current thumbnail belongs to
  const currentPage = await db.collection('pages').findOne({
    book_id: book.id,
    $or: [
      { cropped_photo: book.thumbnail },
      { archived_photo: book.thumbnail },
      { photo: book.thumbnail },
      { photo_original: book.thumbnail },
      { thumbnail_blob: book.thumbnail },
    ]
  }, { projection: { page_number: 1, page_type: 1, 'ocr.data': 1 } });

  // Check if current cover is bad
  const isBadType = currentPage && BAD_PAGE_TYPES.has(currentPage.page_type);
  const isBadOcr = currentPage && isBadCoverOcr(currentPage.ocr?.data);

  // Also flag if no page found (orphan thumbnail) or page_type missing on early pages
  const isOrphan = !currentPage;

  if (!isBadType && !isBadOcr && !isOrphan) {
    alreadyGood++;
    continue;
  }

  const reason = isBadOcr ? 'bad OCR content' : isBadType ? `bad page_type: ${currentPage.page_type}` : 'orphan thumbnail';

  // Find a better page
  const proj = { page_number: 1, page_type: 1, cropped_photo: 1, archived_photo: 1, photo: 1, photo_original: 1, thumbnail_blob: 1, 'ocr.data': 1 };

  // Priority 1: title-page (most reliable cover)
  let bestPage = await db.collection('pages').findOne(
    { book_id: book.id, page_type: 'title-page', page_number: { $lte: 30 } },
    { projection: proj, sort: { page_number: 1 } }
  );

  // Priority 2: frontispiece that isn't a digitizer insert
  if (!bestPage) {
    const frontispieces = await db.collection('pages').find(
      { book_id: book.id, page_type: 'frontispiece', page_number: { $lte: 50 } },
      { projection: proj, sort: { page_number: 1 }, limit: 3 }
    ).toArray();
    bestPage = frontispieces.find(p => !isBadCoverOcr(p.ocr?.data)) || null;
  }

  // Priority 3: illustration within first 15 pages
  if (!bestPage) {
    const illustrations = await db.collection('pages').find(
      { book_id: book.id, page_type: 'illustration', page_number: { $lte: 15 } },
      { projection: proj, sort: { page_number: 1 }, limit: 3 }
    ).toArray();
    bestPage = illustrations.find(p => !isBadCoverOcr(p.ocr?.data)) || null;
  }

  // Priority 4: first non-bad page (with page_type)
  if (!bestPage) {
    const fallbacks = await db.collection('pages').find(
      { book_id: book.id, page_type: { $nin: [...BAD_PAGE_TYPES, null] }, page_number: { $lte: 15 } },
      { projection: proj, sort: { page_number: 1 }, limit: 5 }
    ).toArray();
    bestPage = fallbacks.find(p => !isBadCoverOcr(p.ocr?.data)) || null;
  }

  // Priority 5: for books without page_type data, just grab an early page with an image
  if (!bestPage) {
    const earlyPages = await db.collection('pages').find(
      { book_id: book.id, page_number: { $lte: 10 } },
      { projection: proj, sort: { page_number: 1 }, limit: 10 }
    ).toArray();
    bestPage = earlyPages.find(p => {
      const hasImage = p.cropped_photo || p.archived_photo || p.photo;
      const notBad = !isBadCoverOcr(p.ocr?.data);
      const notBlank = p.page_type !== 'blank' && !(p.ocr?.data || '').includes('<page-type>blank</page-type>');
      return hasImage && notBad && notBlank;
    }) || null;
  }

  if (!bestPage) {
    console.log(`  SKIP "${book.title}" — no good replacement found (${reason})`);
    skipped++;
    continue;
  }

  const newUrl = bestPage.cropped_photo || bestPage.archived_photo || bestPage.photo || bestPage.photo_original;
  if (!newUrl || newUrl === book.thumbnail) {
    alreadyGood++;
    continue;
  }

  const currentPageNum = currentPage?.page_number || '?';
  console.log(`  FIX "${book.title}" — page ${currentPageNum} (${reason}) → page ${bestPage.page_number} (${bestPage.page_type})`);

  if (!DRY_RUN) {
    const update = { thumbnail: newUrl, thumbnail_source: 'auto' };
    if (bestPage.thumbnail_blob) update.thumbnail_blob = bestPage.thumbnail_blob;
    await db.collection('books').updateOne({ id: book.id }, { $set: update });
  }
  fixed++;
}

console.log(`\nDone. Fixed: ${fixed}, Already good: ${alreadyGood}, Skipped: ${skipped}`);
if (DRY_RUN) console.log('(DRY RUN — re-run without DRY_RUN=1 to apply)');

await client.close();
