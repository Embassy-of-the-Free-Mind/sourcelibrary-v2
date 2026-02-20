#!/usr/bin/env node
/**
 * Scan all books for duplicate page numbers and fix them by renumbering
 * sequentially based on MongoDB _id order (preserves original scan order).
 *
 * Usage:
 *   node scripts/maintenance/fix-duplicate-page-numbers.mjs [--dry-run] [--book-id=XXX]
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'bookstore';
const DRY_RUN = process.argv.includes('--dry-run');
const BOOK_ID_ARG = process.argv.find(a => a.startsWith('--book-id='))?.split('=')[1];

if (!MONGODB_URI) {
  console.error('MONGODB_URI not set');
  process.exit(1);
}

async function run() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(MONGODB_DB);
  const pagesCol = db.collection('pages');
  const booksCol = db.collection('books');

  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== LIVE RUN ===');
  console.log('');

  // Step 1: Find all books with duplicate page numbers
  console.log('Scanning for duplicate page numbers...');

  const matchStage = BOOK_ID_ARG ? { $match: { book_id: BOOK_ID_ARG } } : { $match: {} };

  const dupes = await pagesCol.aggregate([
    matchStage,
    { $group: { _id: { book_id: '$book_id', page_number: '$page_number' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $group: { _id: '$_id.book_id', duplicate_count: { $sum: 1 }, duplicate_pages: { $push: '$_id.page_number' } } },
    { $sort: { duplicate_count: -1 } }
  ], { allowDiskUse: true }).toArray();

  if (dupes.length === 0) {
    console.log('No books with duplicate page numbers found.');
    await client.close();
    return;
  }

  console.log(`Found ${dupes.length} books with duplicate page numbers:\n`);

  let totalFixed = 0;

  for (const d of dupes) {
    const book = await booksCol.findOne({ id: d._id }, { projection: { title: 1, pages_count: 1 } });
    const title = (book?.title || 'UNKNOWN').substring(0, 60);
    console.log(`--- ${title} (${d._id}) ---`);
    console.log(`  Duplicate page numbers: ${d.duplicate_count} (pages: ${d.duplicate_pages.sort((a,b) => a-b).join(', ')})`);

    // Get all pages for this book sorted by _id (creation order)
    const pages = await pagesCol.find({ book_id: d._id }, { projection: { _id: 1, id: 1, page_number: 1 } })
      .sort({ _id: 1 })
      .toArray();

    // Check current state
    const currentNumbers = pages.map(p => p.page_number);
    const uniqueNumbers = new Set(currentNumbers);
    console.log(`  Total pages: ${pages.length}, Unique page numbers: ${uniqueNumbers.size}`);

    // Renumber sequentially
    let renumbered = 0;
    const bulkOps = [];

    for (let i = 0; i < pages.length; i++) {
      const expectedNumber = i + 1;
      if (pages[i].page_number !== expectedNumber) {
        renumbered++;
        bulkOps.push({
          updateOne: {
            filter: { _id: pages[i]._id },
            update: { $set: { page_number: expectedNumber } }
          }
        });
      }
    }

    console.log(`  Pages to renumber: ${renumbered}`);

    if (bulkOps.length > 0 && !DRY_RUN) {
      await pagesCol.bulkWrite(bulkOps);

      // Update book pages_count if needed
      if (book && book.pages_count !== pages.length) {
        await booksCol.updateOne({ id: d._id }, { $set: { pages_count: pages.length } });
        console.log(`  Updated pages_count: ${book.pages_count} -> ${pages.length}`);
      }

      console.log(`  FIXED: ${renumbered} pages renumbered`);
    } else if (DRY_RUN) {
      console.log(`  Would fix ${renumbered} pages (dry run)`);
    }

    totalFixed++;
    console.log('');
  }

  console.log(`\nDone. ${totalFixed} books ${DRY_RUN ? 'would be' : 'were'} fixed.`);
  await client.close();
}

run().catch(err => { console.error(err); process.exit(1); });
