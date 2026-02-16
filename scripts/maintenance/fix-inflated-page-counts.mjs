/**
 * Fix inflated page counts from IA import bug.
 *
 * For books where our DB has more pages than the IA IIIF manifest,
 * deletes the excess pages (which have invalid image URLs) and
 * updates the book's pages_count.
 *
 * Usage:
 *   node scripts/maintenance/fix-inflated-page-counts.mjs [--dry-run]
 */

import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const MIN_PAGES = 500; // Only check books with this many pages
const INFLATION_THRESHOLD = 1.5; // Flag if DB count > IIIF * this

async function getIIIFCount(iaId) {
  try {
    const resp = await fetch(
      `https://iiif.archive.org/iiif/${iaId}/manifest.json`,
      { signal: AbortSignal.timeout(20000) }
    );
    if (!resp.ok) return null;
    const d = await resp.json();
    // IIIF v3 uses 'items', v2 uses 'sequences[0].canvases'
    if (d.items) return d.items.length;
    if (d.sequences?.[0]) return d.sequences[0].canvases.length;
    return null;
  } catch {
    return null;
  }
}

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== LIVE RUN ===');
  console.log('');

  // Find all large IA books
  const books = await db.collection('books').find(
    {
      pages_count: { $gt: MIN_PAGES },
      deleted: { $ne: true },
      ia_identifier: { $exists: true, $ne: null }
    },
    { projection: { id: 1, title: 1, pages_count: 1, pages_ocr: 1, ia_identifier: 1 } }
  ).sort({ pages_count: -1 }).toArray();

  console.log(`Checking ${books.length} IA books with >${MIN_PAGES} pages...`);

  // Phase 1: Fetch all IIIF counts in parallel (20 at a time)
  console.log(`Fetching IIIF manifests (20 concurrent)...`);
  const CONCURRENCY = 20;
  const iiifCounts = new Map();
  for (let i = 0; i < books.length; i += CONCURRENCY) {
    const batch = books.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (book) => {
        const count = await getIIIFCount(book.ia_identifier);
        return { id: book.id, count };
      })
    );
    for (const r of results) iiifCounts.set(r.id, r.count);
    process.stdout.write(`  ${Math.min(i + CONCURRENCY, books.length)}/${books.length}\r`);
  }
  console.log(`\nIIIF fetch complete. Processing...\n`);

  // Phase 2: Process inflated books
  let totalDeleted = 0;
  let totalOcrLost = 0;
  const fixed = [];

  for (const book of books) {
    const iiifCount = iiifCounts.get(book.id);
    if (iiifCount === null || iiifCount === undefined) {
      // Only log skips for very large books to reduce noise
      if (book.pages_count > 1500) {
        console.log(`  SKIP (no IIIF) ${book.pages_count}p  ${book.title.slice(0, 55)}`);
      }
      continue;
    }

    const ratio = book.pages_count / iiifCount;
    if (ratio < INFLATION_THRESHOLD) {
      continue;
    }

    // Find pages beyond the real count
    // Pages are numbered 1..N, IIIF canvases are 0..N-1
    // So pages with page_number > iiifCount are fake
    const excessPages = await db.collection('pages').find(
      { book_id: book.id, page_number: { $gt: iiifCount } },
      { projection: { _id: 1, id: 1, page_number: 1, 'ocr.data': 1 } }
    ).toArray();

    const withOcr = excessPages.filter(p => p.ocr?.data && p.ocr.data.length > 0);

    console.log(`  FIX ${book.pages_count} → ${iiifCount} (${ratio.toFixed(1)}x, ${excessPages.length} excess, ${withOcr.length} have OCR)  ${book.title.slice(0, 50)}`);

    if (withOcr.length > 0) {
      console.log(`    WARNING: ${withOcr.length} excess pages have OCR data (will be deleted)`);
      totalOcrLost += withOcr.length;
    }

    if (!DRY_RUN) {
      // Delete excess pages
      const deleteResult = await db.collection('pages').deleteMany(
        { book_id: book.id, page_number: { $gt: iiifCount } }
      );

      // Update book pages_count
      await db.collection('books').updateOne(
        { id: book.id },
        {
          $set: {
            pages_count: iiifCount,
            updated_at: new Date()
          },
          $unset: { job: '' } // Clear any stale job reference
        }
      );

      // Recount OCR and translation pages
      const ocrCount = await db.collection('pages').countDocuments(
        { book_id: book.id, 'ocr.data': { $exists: true, $ne: '' } }
      );
      const translationCount = await db.collection('pages').countDocuments(
        { book_id: book.id, 'translation.data': { $exists: true, $ne: '' } }
      );

      await db.collection('books').updateOne(
        { id: book.id },
        { $set: { pages_ocr: ocrCount, pages_translated: translationCount } }
      );

      console.log(`    Deleted ${deleteResult.deletedCount} pages, set pages_count=${iiifCount}, ocr=${ocrCount}, translated=${translationCount}`);
      totalDeleted += deleteResult.deletedCount;
    } else {
      totalDeleted += excessPages.length;
    }

    fixed.push({
      title: book.title,
      old: book.pages_count,
      new: iiifCount,
      deleted: excessPages.length,
      ocrLost: withOcr.length
    });
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Books fixed: ${fixed.length}`);
  console.log(`Pages deleted: ${totalDeleted}`);
  console.log(`OCR pages lost: ${totalOcrLost}`);
  if (DRY_RUN) console.log('(DRY RUN — no changes made)');

  await client.close();
}

run().catch(e => { console.error(e); process.exit(1); });
