/**
 * Fix Book Covers
 *
 * Finds books where the cover is page 1, then uses OCR page_type
 * and detected_images data to select a better cover (title page,
 * frontispiece, or illustration).
 *
 * Cost: FREE — uses existing OCR metadata, no API calls.
 *
 * Usage:
 *   set -a; source .env.local; set +a; node scripts/maintenance/fix-covers.mjs
 *   node scripts/maintenance/fix-covers.mjs --dry-run
 *   node scripts/maintenance/fix-covers.mjs --limit 50
 *   node scripts/maintenance/fix-covers.mjs --book-id abc123
 */

import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = (() => {
  const idx = process.argv.indexOf('--limit');
  return idx !== -1 ? parseInt(process.argv[idx + 1]) : 0;
})();
const BOOK_ID = (() => {
  const idx = process.argv.indexOf('--book-id');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();
const RECHECK = process.argv.includes('--recheck'); // Re-evaluate auto-selected covers
const SCAN_PAGES = 20;
const BATCH_SIZE = 100; // Process books in batches

const client = new MongoClient(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 30000,
  connectTimeoutMS: 30000,
  socketTimeoutMS: 60000,
});
await client.connect();
const db = client.db('bookstore');

/**
 * Detect if a page is an ex-libris bookplate rather than real content.
 * These are often misclassified as "frontispiece" by OCR.
 */
function isExLibris(page) {
  const ocrSnippet = (page.ocr_snippet || '').toLowerCase();
  const patterns = [
    'bookplate', 'ex-libris', 'exlibris', 'ex libris',
    'ownership mark', 'library sticker',
  ];
  if (patterns.some(p => ocrSnippet.includes(p))) return true;

  // BPH pelican bookplate (Embassy of the Free Mind)
  if (ocrSnippet.includes('philosophia hermetica') || ocrSnippet.includes('philosophica hermetica')) return true;
  if (ocrSnippet.includes('pelican') && (ocrSnippet.includes('piety') || ocrSnippet.includes('nest') || ocrSnippet.includes('hermetica'))) return true;

  // "pasted-in emblem" on early pages is almost always a bookplate
  if (page.page_number <= 5 && ocrSnippet.includes('pasted') && ocrSnippet.includes('emblem')) return true;

  return false;
}

/**
 * Score a page as a potential cover. Higher = better.
 */
function scorePage(page) {
  let score = 0;
  const pageType = page.page_type;

  // Ex-libris bookplates should never be covers
  if (isExLibris(page)) return -50;

  // Page type scoring
  if (pageType === 'frontispiece') score += 100;
  else if (pageType === 'title-page') score += 90;
  else if (pageType === 'illustration') score += 70;
  else if (pageType === 'dedication') score += 20;

  // Detected images scoring
  if (page.detected_images?.length > 0) {
    const validImages = page.detected_images.filter(Boolean);
    const bestImage = validImages.length > 0 ? validImages.reduce((best, img) =>
      (img.gallery_quality || 0) > (best.gallery_quality || 0) ? img : best
    , validImages[0]) : null;

    if (!bestImage) return score; // all entries were null
    const quality = bestImage.gallery_quality || 0;
    score += quality * 50;

    const type = bestImage.type?.toLowerCase();
    if (type === 'frontispiece') score += 30;
    else if (type === 'engraving') score += 25;
    else if (type === 'emblem') score += 25;
    else if (type === 'portrait') score += 20;
    else if (type === 'woodcut') score += 15;
  }

  // Penalize pages deep in the book
  if (page.page_number > 10) score -= 5;
  if (page.page_number > 15) score -= 10;

  // Skip blank pages
  if (pageType === 'blank') score = -100;

  return score;
}

/**
 * Check if a book's thumbnail is from page 1.
 */
function isThumbnailFromPage1(book, page1) {
  if (!book.thumbnail && !book.thumbnail_blob) return true;
  if (!page1) return false;

  const bookThumb = book.thumbnail_blob || book.thumbnail || '';
  const page1Urls = [
    page1.thumbnail_blob, page1.thumbnail, page1.photo,
    page1.photo_original, page1.archived_photo, page1.cropped_photo,
  ].filter(Boolean);

  for (const url of page1Urls) {
    if (bookThumb === url) return true;
    if (bookThumb.includes(encodeURIComponent(url))) return true;
  }

  // IA-specific patterns
  if (bookThumb.includes('page/n0/') || bookThumb.includes('page/n0%2F')) return true;
  if (bookThumb.includes('leaf0/') || bookThumb.includes('leaf0%2F')) return true;

  // IIIF base path match
  if (page1.photo_original) {
    const page1Base = page1.photo_original.split('/').slice(0, -3).join('/');
    if (page1Base && bookThumb.includes(page1Base)) return true;
  }

  return false;
}

// --- Main ---
console.log(`\n=== Fix Book Covers ===`);
console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}${RECHECK ? ' (recheck auto covers)' : ''}`);
if (BOOK_ID) console.log(`Book: ${BOOK_ID}`);
if (LIMIT) console.log(`Limit: ${LIMIT}`);

// Step 1: Fetch all books (lightweight)
const bookQuery = BOOK_ID
  ? { id: BOOK_ID }
  : RECHECK
    ? { hidden: { $ne: true }, cover_source: 'auto' }
    : { hidden: { $ne: true } };

const allBooks = await db.collection('books')
  .find(bookQuery, {
    projection: { id: 1, title: 1, thumbnail: 1, thumbnail_blob: 1, cover_source: 1, _id: 0 }
  })
  .toArray();

console.log(`Found ${allBooks.length} books. Processing in batches of ${BATCH_SIZE}...\n`);

let checked = 0, fixed = 0, skipped = 0, noData = 0;
const changes = [];

// Step 2: Process in batches
for (let i = 0; i < allBooks.length; i += BATCH_SIZE) {
  if (LIMIT && fixed >= LIMIT) break;

  const batch = allBooks.slice(i, i + BATCH_SIZE);
  const batchBookIds = batch.map(b => b.id);

  // Single query: get first SCAN_PAGES pages for all books in this batch
  // Include ocr.data for ex-libris detection (truncated in JS to save memory)
  const allPages = await db.collection('pages')
    .find(
      { book_id: { $in: batchBookIds }, page_number: { $lte: SCAN_PAGES } },
      {
        projection: {
          book_id: 1, id: 1, page_number: 1, page_type: 1, detected_images: 1,
          thumbnail_blob: 1, thumbnail: 1,
          photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1,
          'ocr.data': 1,
        }
      }
    )
    .sort({ book_id: 1, page_number: 1 })
    .toArray();

  // Truncate OCR to first 500 chars for ex-libris detection (save memory)
  for (const p of allPages) {
    p.ocr_snippet = (p.ocr?.data || '').substring(0, 500);
    delete p.ocr;
  }

  // Group pages by book_id
  const pagesByBook = new Map();
  for (const p of allPages) {
    if (!pagesByBook.has(p.book_id)) pagesByBook.set(p.book_id, []);
    pagesByBook.get(p.book_id).push(p);
  }

  // Process each book
  for (const book of batch) {
    if (LIMIT && fixed >= LIMIT) break;

    const pages = pagesByBook.get(book.id);
    if (!pages || pages.length === 0) { noData++; continue; }

    checked++;
    const page1 = pages[0];

    // In recheck mode, find the current cover page and check if it's ex-libris
    if (RECHECK) {
      const bookThumb = book.thumbnail_blob || book.thumbnail || '';
      const currentCoverPage = pages.find(p =>
        (p.thumbnail_blob && bookThumb === p.thumbnail_blob) ||
        (p.archived_photo && bookThumb === p.archived_photo)
      );
      if (!currentCoverPage || !isExLibris(currentCoverPage)) { skipped++; continue; }
    } else {
      if (!isThumbnailFromPage1(book, page1)) { skipped++; continue; }
    }

    // Score all pages
    const scored = pages
      .map(p => ({ page: p, score: scorePage(p) }))
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    const currentPageNum = RECHECK ? '(ex-libris)' : page1.page_number;

    // Min score 40: frontispiece=100, title-page=90, illustration=70, good image=~50+
    if (!RECHECK && best.page.page_number === page1.page_number) { skipped++; continue; }
    if (best.score < 40) {
      skipped++;
      continue;
    }

    const bestPage = best.page;
    const updates = {};

    if (bestPage.thumbnail_blob) updates.thumbnail_blob = bestPage.thumbnail_blob;

    const fullSizeUrl = bestPage.archived_photo || bestPage.cropped_photo || bestPage.photo || bestPage.photo_original;
    if (fullSizeUrl) updates.thumbnail = fullSizeUrl;

    if (!updates.thumbnail && !updates.thumbnail_blob) { skipped++; continue; }

    const reason = bestPage.page_type
      ? `${bestPage.page_type} (page ${bestPage.page_number}, score: ${best.score})`
      : `best image (page ${bestPage.page_number}, score: ${best.score})`;

    changes.push({
      bookId: book.id,
      title: book.title?.substring(0, 60),
      from: RECHECK ? 'ex-libris' : `page ${page1.page_number}`,
      to: `page ${bestPage.page_number}`,
      reason,
      score: best.score,
    });

    if (!DRY_RUN) {
      await db.collection('books').updateOne(
        { id: book.id },
        { $set: { ...updates, cover_updated_at: new Date(), cover_source: 'auto' } }
      );
    }

    fixed++;
  }

  process.stdout.write(`  Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allBooks.length / BATCH_SIZE)} — ${fixed} fixes so far\r`);
}

// Summary
console.log(`\n\n=== Results ===`);
console.log(`Books checked: ${checked}`);
console.log(`Already good (not page 1, or page 1 is best): ${skipped}`);
console.log(`No pages: ${noData}`);
console.log(`${DRY_RUN ? 'Would fix' : 'Fixed'}: ${fixed}`);

if (changes.length > 0) {
  console.log(`\n--- Changes ${DRY_RUN ? '(preview)' : '(applied)'} ---`);
  for (const c of changes) {
    console.log(`  ${c.title}`);
    console.log(`    ${c.from} → ${c.to} | ${c.reason}`);
  }
}

if (DRY_RUN && fixed > 0) {
  console.log(`\nRun without --dry-run to apply these changes.`);
}

await client.close();
