/**
 * Smart Cover Selection (OCR-based, no API calls)
 *
 * Picks the best cover by analyzing OCR text content — not just page_type,
 * but the actual descriptions, meta tags, and transcribed text.
 * Parses <page-type> tags from OCR when page_type field is null.
 *
 * Cost: FREE
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/smart-cover-selection.mjs
 *   --dry-run         Preview changes
 *   --limit N         Process first N books
 *   --book-id ID      Process single book
 *   --collection SLUG Process books in a specific collection
 *   --skip-manual     Skip books with thumbnail_source: 'manual'
 *   --force           Re-evaluate all books (not just page-1 covers)
 */

import { MongoClient } from 'mongodb';
import { scorePageForCover } from '../lib/cover-scoring.mjs';
import { buildCoverUpdate } from '../lib/cover-write.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_MANUAL = process.argv.includes('--skip-manual');
const FORCE = process.argv.includes('--force');
const LIMIT = (() => {
  const idx = process.argv.indexOf('--limit');
  return idx !== -1 ? parseInt(process.argv[idx + 1]) : 0;
})();
const BOOK_ID = (() => {
  const idx = process.argv.indexOf('--book-id');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();
const PROVIDER = (() => {
  const idx = process.argv.indexOf('--provider');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();
const COLLECTION = (() => {
  const idx = process.argv.indexOf('--collection');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();

const SCAN_PAGES = 20;
const BATCH_SIZE = 50;

const client = new MongoClient(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 30000, connectTimeoutMS: 30000, socketTimeoutMS: 60000,
});
await client.connect();
const db = client.db('bookstore');

// Cover URLs are resolved inside buildCoverUpdate (cover-write.mjs) — see top of file.

// --- Main ---
console.log(`\n=== Smart Cover Selection (OCR-based) ===`);
console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}${FORCE ? ' (force re-evaluate all)' : ''}`);
if (BOOK_ID) console.log(`Book: ${BOOK_ID}`);
if (COLLECTION) console.log(`Collection: ${COLLECTION}`);
if (LIMIT) console.log(`Limit: ${LIMIT}`);

const bookQuery = BOOK_ID
  ? { id: BOOK_ID }
  : { pages_count: { $gt: 0 }, visible: true };

if (!BOOK_ID && SKIP_MANUAL) {
  bookQuery.thumbnail_source = { $ne: 'manual' };
}
if (!BOOK_ID && PROVIDER) {
  bookQuery['image_source.provider'] = PROVIDER;
}
if (!BOOK_ID && COLLECTION) {
  bookQuery.collections = COLLECTION;
}

const allBooks = await db.collection('books')
  .find(bookQuery, {
    projection: { id: 1, title: 1, thumbnail: 1, thumbnail_source: 1, _id: 0 }
  })
  .toArray();

console.log(`Found ${allBooks.length} books. Processing in batches of ${BATCH_SIZE}...\n`);

let checked = 0, upgraded = 0, skipped = 0, noData = 0;
const changes = [];

for (let i = 0; i < allBooks.length; i += BATCH_SIZE) {
  if (LIMIT && upgraded >= LIMIT) break;

  const batch = allBooks.slice(i, i + BATCH_SIZE);
  const batchBookIds = batch.map(b => b.id);

  // Get first SCAN_PAGES pages with OCR text for scoring
  const allPages = await db.collection('pages')
    .find(
      { book_id: { $in: batchBookIds }, page_number: { $lte: SCAN_PAGES }, hidden: { $ne: true } },
      {
        projection: {
          book_id: 1, page_number: 1, page_type: 1,
          photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1,
          enhanced_photo: 1, image_thumb: 1, thumbnail_blob: 1,
          'ocr.data': 1,
        }
      }
    )
    .sort({ book_id: 1, page_number: 1 })
    .toArray();

  // Group by book — keep ocr.data intact for the shared scorer
  const pagesByBook = new Map();
  for (const p of allPages) {
    if (!pagesByBook.has(p.book_id)) pagesByBook.set(p.book_id, []);
    pagesByBook.get(p.book_id).push(p);
  }

  for (const book of batch) {
    if (LIMIT && upgraded >= LIMIT) break;

    const pages = pagesByBook.get(book.id);
    if (!pages || pages.length === 0) { noData++; continue; }
    checked++;

    // Score all pages using shared scoring module
    const scored = pages
      .map(p => {
        const { score, reason } = scorePageForCover(p, { bookTitle: book.title });
        return { page: p, score, reason };
      })
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (best.score < 30) { skipped++; continue; }

    // Build the canonical four-field cover update (issue #4276: this script
    // used to write only legacy `thumbnail` + nonstandard `cover_page_number`,
    // leaving image_display/image_thumb stale — the exact partial-write class
    // the cover-fields contract exists to prevent).
    const update = buildCoverUpdate(best.page, {
      source: 'smart_ocr',
      method: 'smart-cover-selection',
      actor: 'script',
      confidence: 0.8,
      detail: `${best.reason} (score ${best.score})`,
    });
    if (!update) { skipped++; continue; }

    // Check if it's different from current cover
    const currentThumb = book.thumbnail || '';
    if (currentThumb === update.image_display) { skipped++; continue; }

    // In non-force mode, also skip if current cover is from a later page
    // (it was likely already upgraded and might be correct)
    if (!FORCE && book.thumbnail_source === 'ai_vision') { skipped++; continue; }

    upgraded++;
    const shortTitle = (book.title || '').substring(0, 55);
    changes.push({
      title: shortTitle,
      bookId: book.id,
      from: book.thumbnail_source || 'unknown',
      toPage: best.page.page_number,
      reason: best.reason,
      score: best.score,
      debug: BOOK_ID ? scored.slice(0, 8).map(s => `p${s.page.page_number}: ${s.score} (${s.reason})`) : null,
    });

    if (!DRY_RUN) {
      // updated_at bump lets sync-books-catalog's incremental mode pick the
      // book up; remember to run it (and revalidate) after a live sweep.
      await db.collection('books').updateOne(
        { id: book.id },
        { $set: { ...update, updated_at: new Date() } }
      );
    }
  }

  const batchNum = Math.floor(i / BATCH_SIZE) + 1;
  const totalBatches = Math.ceil(allBooks.length / BATCH_SIZE);
  process.stdout.write(`  Batch ${batchNum}/${totalBatches} — ${upgraded} upgrades so far\r`);
}

// Summary
console.log(`\n\n=== Results ===`);
console.log(`Books checked: ${checked}`);
console.log(`${DRY_RUN ? 'Would upgrade' : 'Upgraded'}: ${upgraded}`);
console.log(`Skipped (already best or low score): ${skipped}`);
console.log(`No pages: ${noData}`);

if (BOOK_ID && changes.length > 0) {
  console.log(`\n--- Scoring detail ---`);
  for (const c of changes) {
    console.log(`  ${c.title}`);
    console.log(`  Best: page ${c.toPage} (${c.reason}, score: ${c.score})`);
    if (c.debug) {
      for (const d of c.debug) console.log(`    ${d}`);
    }
  }
} else if (changes.length > 0) {
  console.log(`\n--- Changes ${DRY_RUN ? '(preview)' : '(applied)'} ---`);
  for (const c of changes.slice(0, 100)) {
    console.log(`  ${c.title}`);
    console.log(`    → page ${c.toPage} | ${c.reason} (score: ${c.score})`);
  }
  if (changes.length > 100) console.log(`  ... and ${changes.length - 100} more`);
}

if (DRY_RUN && upgraded > 0) {
  console.log(`\nRun without --dry-run to apply.`);
}

await client.close();
