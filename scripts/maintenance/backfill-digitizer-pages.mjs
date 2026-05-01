/**
 * Backfill: detect and tag Google Books / IA digitizer notice pages.
 *
 * Scans pages 1-3 (and last 3) of all books, checks OCR text for digitizer
 * patterns, and sets page_type: 'digitizer-insert' + hidden: true.
 *
 * The UI already filters these (page_type !== 'digitizer-insert').
 * The pipeline (Phase 8.9) now detects them going forward — this script
 * catches existing books that were imported before detection was added.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/backfill-digitizer-pages.mjs
 *   --dry-run       Preview without writing
 *   --limit N       Process first N books
 *   --book-id ID    Process single book
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

const BATCH_SIZE = 100;

function isDigitizerNotice(text) {
  if (!text) return false;
  // Trust the OCR model's page-type tag first
  const pageTypeMatch = text.match(/<page-type>([^<]+)<\/page-type>/);
  if (pageTypeMatch?.[1] === 'digitizer-insert') return true;

  // Body-text fallback: match full-page Google/IA notices (strip <meta> descriptions first)
  const bodyText = text.substring(0, 2000).replace(/<meta>[\s\S]*?<\/meta>/g, '');
  return /this is a digital copy of a book|reproduction of a library book that was digitized|digitized by google as part of an ongoing/i.test(bodyText) ||
    /inserted by the internet archive/i.test(bodyText);
}

const client = new MongoClient(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 30000, connectTimeoutMS: 30000, socketTimeoutMS: 60000,
});
await client.connect();
const db = client.db('bookstore');

console.log(`\n=== Backfill Digitizer Page Detection ===`);
console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);

const bookQuery = BOOK_ID
  ? { id: BOOK_ID }
  : { pages_count: { $gt: 0 } };

const booksCursor = db.collection('books')
  .find(bookQuery, { projection: { id: 1, title: 1, pages_count: 1, _id: 0 } })
  .sort({ _id: -1 });

let booksChecked = 0, pagesTagged = 0, booksAffected = 0;
const affected = [];
let batch = [];

for await (const book of booksCursor) {
  if (LIMIT && booksChecked >= LIMIT) break;
  batch.push(book);

  if (batch.length >= BATCH_SIZE) {
    await processBatch(batch);
    batch = [];
  }
}
if (batch.length > 0) await processBatch(batch);

async function processBatch(books) {
  const bookIds = books.map(b => b.id);
  const bookMap = new Map(books.map(b => [b.id, b]));

  // Fetch edge pages (first 3 + last 3) that haven't already been tagged
  const pages = await db.collection('pages')
    .find(
      {
        book_id: { $in: bookIds },
        page_type: { $nin: ['digitizer-notice', 'digitizer-insert'] },
        $or: [
          { page_number: { $lte: 3 } },
          // We check last 3 via a secondary pass per-book below
        ],
      },
      { projection: { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, _id: 0 } }
    )
    .toArray();

  // Also fetch last-3 pages for books with many pages
  const lastPageQueries = books
    .filter(b => b.pages_count > 6)
    .map(b => ({
      book_id: b.id,
      page_number: { $gte: b.pages_count - 2 },
      page_type: { $nin: ['digitizer-notice', 'digitizer-insert'] },
    }));

  if (lastPageQueries.length > 0) {
    const lastPages = await db.collection('pages')
      .find(
        { $or: lastPageQueries },
        { projection: { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, _id: 0 } }
      )
      .toArray();
    pages.push(...lastPages);
  }

  const bulkOps = [];
  const booksHit = new Set();

  for (const page of pages) {
    booksChecked; // just for counting
    if (isDigitizerNotice(page.ocr?.data)) {
      booksHit.add(page.book_id);
      pagesTagged++;
      if (!DRY_RUN) {
        bulkOps.push({
          updateOne: {
            filter: { id: page.id },
            update: {
              $set: {
                page_type: 'digitizer-insert',
                hidden: true,
                updated_at: new Date(),
                'field_provenance.page_type': {
                  source: 'backfill', method: 'digitizer-pattern-match',
                  confidence: 0.95, date: new Date(),
                },
              },
            },
          },
        });
      }
    }
  }

  if (bulkOps.length > 0) {
    await db.collection('pages').bulkWrite(bulkOps, { ordered: false });
  }

  for (const bookId of booksHit) {
    const book = bookMap.get(bookId);
    booksAffected++;
    affected.push({ id: bookId, title: (book?.title || '').substring(0, 60) });
  }

  booksChecked += books.length;
  process.stdout.write(`  Checked ${booksChecked} books, tagged ${pagesTagged} pages\r`);
}

console.log(`\n\n=== Results ===`);
console.log(`Books checked: ${booksChecked}`);
console.log(`Books with digitizer pages: ${booksAffected}`);
console.log(`Pages ${DRY_RUN ? 'would tag' : 'tagged'}: ${pagesTagged}`);

if (affected.length > 0) {
  console.log(`\n--- Affected books ---`);
  for (const b of affected.slice(0, 50)) {
    console.log(`  ${b.title} (${b.id})`);
  }
  if (affected.length > 50) console.log(`  ... and ${affected.length - 50} more`);
}

if (DRY_RUN && pagesTagged > 0) {
  console.log(`\nRun without --dry-run to apply.`);
}

await client.close();
