#!/usr/bin/env node
/**
 * Backfill book covers using page_type metadata.
 *
 * Re-runs the same logic as the post-import pipeline's upgradeThumbnailFromPageType,
 * but across ALL non-manual books. Creates a page_type index if missing.
 *
 * The ex libris filter is strict: only filters pages whose PRIMARY content is a
 * bookplate/ownership mark (via <image-desc>). Pages that happen to have an ex libris
 * stamp but are otherwise real frontispieces are kept.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/thumbnails/backfill-covers.mjs
 *   node scripts/thumbnails/backfill-covers.mjs --dry-run        # Preview changes
 *   node scripts/thumbnails/backfill-covers.mjs --limit=100      # Process N books
 *   node scripts/thumbnails/backfill-covers.mjs --book-id=abc123 # Single book
 */

import { MongoClient } from 'mongodb';

const MONGO_OPTS = {
  serverSelectionTimeoutMS: 60000,
  socketTimeoutMS: 120000,
  connectTimeoutMS: 30000,
};

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || 0;
const BOOK_ID = args.find(a => a.startsWith('--book-id='))?.split('=')[1] || null;

/**
 * Detect pages that are PRIMARILY bookplates / ex libris pages.
 * A frontispiece with a small ex libris stamp should NOT be filtered.
 * Only filter if the image description itself describes a bookplate.
 */
function isBookplatePage(ocrData) {
  if (!ocrData) return false;

  // Extract the image-desc section — that describes what the page actually IS
  const imageDescMatch = ocrData.match(/<image-desc>([\s\S]*?)<\/image-desc>/);
  const imageDesc = imageDescMatch ? imageDescMatch[1] : '';

  // If the image description describes a bookplate, it's a bookplate page
  if (/bookplate|ex[\s\-.]?libris|ownership\s+(mark|stamp)|pasted-in\s+.*label/i.test(imageDesc)) {
    // But not if it also describes a substantial illustration
    if (/allegor|engraving|copperplate|frontispiece.*illustration|elaborate.*scene/i.test(imageDesc)) {
      return false; // Real frontispiece with an ex libris stamp
    }
    return true;
  }

  // If page_type was set to frontispiece by the classifier, trust it —
  // a <meta> mention of "library stamp" doesn't make it a bookplate page
  return false;
}

function getPageUrl(page) {
  return page.cropped_photo || page.archived_photo || page.photo;
}

async function run() {
  const client = await MongoClient.connect(process.env.MONGODB_URI, MONGO_OPTS);
  const db = client.db('bookstore');

  // Step 1: Ensure index exists
  console.log('Ensuring page_type index...');
  await db.collection('pages').createIndex(
    { page_type: 1, book_id: 1, page_number: 1 },
    { name: 'pages_page_type_book_idx', background: true, partialFilterExpression: { page_type: { $exists: true } } }
  );
  console.log('Index ready.');

  // Step 2: Get frontispiece candidates (top 3 per book, first 50 pages)
  // We take multiple so we can skip bookplate pages and still find a real frontispiece
  console.log('\nScanning frontispiece pages...');
  const frontispieces = await db.collection('pages').aggregate([
    { $match: { page_type: 'frontispiece', page_number: { $lte: 50 } } },
    { $sort: { page_number: 1 } },
    { $group: {
      _id: '$book_id',
      pages: { $push: {
        page_number: '$page_number',
        archived_photo: '$archived_photo',
        cropped_photo: '$cropped_photo',
        photo: '$photo',
        thumbnail_blob: '$thumbnail_blob',
        ocr_data: '$ocr.data',
      }},
    }},
    { $project: { pages: { $slice: ['$pages', 3] } } },
  ], { allowDiskUse: true, maxTimeMS: 120000 }).toArray();
  console.log(`Found ${frontispieces.length} books with frontispieces`);

  const fpMap = new Map();
  let bookplateSkips = 0;
  for (const book of frontispieces) {
    // Pick the first non-bookplate frontispiece with a valid URL
    let picked = false;
    for (const page of book.pages) {
      if (isBookplatePage(page.ocr_data)) { bookplateSkips++; continue; }
      const url = getPageUrl(page);
      if (url) {
        fpMap.set(book._id, { url, page: page.page_number, thumbnail_blob: page.thumbnail_blob, type: 'frontispiece' });
        picked = true;
        break;
      }
    }
  }
  console.log(`  Usable frontispieces: ${fpMap.size} (${bookplateSkips} bookplate pages skipped)`);

  // Step 3: Get title pages for books WITHOUT a usable frontispiece
  console.log('Scanning title pages...');
  const titlePages = await db.collection('pages').aggregate([
    { $match: { page_type: 'title-page', page_number: { $lte: 30 } } },
    { $sort: { page_number: 1 } },
    { $group: {
      _id: '$book_id',
      page_number: { $first: '$page_number' },
      archived_photo: { $first: '$archived_photo' },
      cropped_photo: { $first: '$cropped_photo' },
      photo: { $first: '$photo' },
      thumbnail_blob: { $first: '$thumbnail_blob' },
    }},
  ], { allowDiskUse: true, maxTimeMS: 120000 }).toArray();

  const tpMap = new Map();
  for (const tp of titlePages) {
    if (fpMap.has(tp._id)) continue; // frontispiece takes priority
    const url = getPageUrl(tp);
    if (url) tpMap.set(tp._id, { url, page: tp.page_number, thumbnail_blob: tp.thumbnail_blob, type: 'title-page' });
  }
  console.log(`Found ${titlePages.length} books with title pages (${tpMap.size} without frontispiece)`);

  // Merge all candidates
  const allCandidates = new Map([...fpMap, ...tpMap]);
  console.log(`\nTotal cover candidates: ${allCandidates.size}`);

  // Step 4: Find books that need updating
  const bookFilter = { deleted: { $ne: true }, thumbnail_source: { $ne: 'manual' } };
  if (BOOK_ID) bookFilter.id = BOOK_ID;

  const books = await db.collection('books').find(bookFilter, {
    projection: { id: 1, title: 1, thumbnail: 1, thumbnail_source: 1 }
  }).toArray();

  let updated = 0;
  let skipped = 0;
  let alreadyGood = 0;
  const changes = [];

  for (const book of books) {
    const candidate = allCandidates.get(book.id);
    if (!candidate) { skipped++; continue; }

    // Already pointing to this URL?
    if (book.thumbnail === candidate.url) { alreadyGood++; continue; }

    if (LIMIT && updated >= LIMIT) break;

    changes.push({
      id: book.id,
      title: book.title?.substring(0, 60),
      from: book.thumbnail?.split('/').slice(-2).join('/'),
      to: candidate.url.split('/').slice(-2).join('/'),
      type: candidate.type,
      page: candidate.page,
      oldSource: book.thumbnail_source || 'unset',
    });

    if (!DRY_RUN) {
      const update = { thumbnail: candidate.url, thumbnail_source: 'auto' };
      if (candidate.thumbnail_blob) update.thumbnail_blob = candidate.thumbnail_blob;
      await db.collection('books').updateOne({ id: book.id }, { $set: update });
    }
    updated++;
  }

  // Report
  console.log('\n--- Results ---');
  console.log(`Updated: ${updated}${DRY_RUN ? ' (dry run)' : ''}`);
  console.log(`Already good: ${alreadyGood}`);
  console.log(`No candidate (no frontispiece or title-page in page_type data): ${skipped}`);
  console.log(`Total books checked: ${books.length}`);

  if (changes.length <= 50) {
    console.log('\nChanges:');
    for (const c of changes) {
      console.log(`  ${c.type} p${c.page} [was ${c.oldSource}]: ${c.title}`);
      console.log(`    ${c.from} → ${c.to}`);
    }
  } else {
    console.log(`\nSample changes (first 30 of ${changes.length}):`);
    for (const c of changes.slice(0, 30)) {
      console.log(`  ${c.type} p${c.page} [was ${c.oldSource}]: ${c.title}`);
    }
  }

  await client.close();
}

run().catch(err => { console.error(err); process.exit(1); });
