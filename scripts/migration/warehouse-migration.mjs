#!/usr/bin/env node
/**
 * Migration: Move archived books to warehouse collections.
 *
 * Moves books with pipeline_auto.status in ['archiving', 'archive_complete']
 * from `books` → `books_warehouse` and their pages from `pages` → `pages_warehouse`.
 *
 * Safe to re-run (idempotent). Uses batched operations to avoid memory issues.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/migration/warehouse-migration.mjs
 *   # Dry run:
 *   set -a; source .env.production.local; set +a; node scripts/migration/warehouse-migration.mjs --dry-run
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 100; // Books per batch
const WAREHOUSE_STATUSES = ['archiving', 'archive_complete'];

async function run() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  console.log(`[warehouse-migration] ${DRY_RUN ? 'DRY RUN — ' : ''}Starting at ${new Date().toISOString()}`);

  // Ensure indexes on warehouse collections
  if (!DRY_RUN) {
    console.log('[warehouse-migration] Creating warehouse indexes...');
    await db.collection('books_warehouse').createIndex({ id: 1 }, { unique: true });
    await db.collection('books_warehouse').createIndex({ 'pipeline_auto.status': 1 });
    await db.collection('books_warehouse').createIndex({ ia_identifier: 1 });
    await db.collection('pages_warehouse').createIndex({ book_id: 1, page_number: 1 });
    await db.collection('pages_warehouse').createIndex({ book_id: 1 });
    console.log('[warehouse-migration] Indexes created.');
  }

  // Count books to move
  const totalToMove = await db.collection('books').countDocuments({
    'pipeline_auto.status': { $in: WAREHOUSE_STATUSES }
  });
  console.log(`[warehouse-migration] Found ${totalToMove} books to warehouse`);

  if (totalToMove === 0) {
    console.log('[warehouse-migration] Nothing to do.');
    await client.close();
    return;
  }

  let movedBooks = 0;
  let movedPages = 0;
  let errors = 0;

  // Process in batches
  while (movedBooks < totalToMove) {
    const batch = await db.collection('books').find({
      'pipeline_auto.status': { $in: WAREHOUSE_STATUSES }
    }).limit(BATCH_SIZE).toArray();

    if (batch.length === 0) break;

    for (const book of batch) {
      const bookId = book.id || book._id.toString();
      try {
        if (DRY_RUN) {
          const pageCount = await db.collection('pages').countDocuments({ book_id: bookId });
          console.log(`  [dry] Would move: ${bookId} "${book.title?.substring(0, 50)}" (${pageCount} pages, status: ${book.pipeline_auto?.status})`);
          movedBooks++;
          movedPages += pageCount;
          continue;
        }

        // 1. Upsert book into warehouse
        await db.collection('books_warehouse').replaceOne(
          { id: bookId },
          book,
          { upsert: true }
        );

        // 2. Move pages in sub-batches (some books have 500+ pages)
        let pagesMoved = 0;
        while (true) {
          const pages = await db.collection('pages')
            .find({ book_id: bookId })
            .limit(500)
            .toArray();

          if (pages.length === 0) break;

          const bulkOps = pages.map(page => ({
            replaceOne: {
              filter: { _id: page._id },
              replacement: page,
              upsert: true,
            }
          }));
          await db.collection('pages_warehouse').bulkWrite(bulkOps, { ordered: false });

          // Delete moved pages from live
          const pageIds = pages.map(p => p._id);
          await db.collection('pages').deleteMany({ _id: { $in: pageIds } });
          pagesMoved += pages.length;
        }

        // 3. Delete book from live
        await db.collection('books').deleteOne({ _id: book._id });

        movedPages += pagesMoved;
        movedBooks++;

        if (movedBooks % 100 === 0) {
          console.log(`[warehouse-migration] Progress: ${movedBooks}/${totalToMove} books, ${movedPages} pages moved`);
        }
      } catch (err) {
        errors++;
        console.error(`[warehouse-migration] Error moving ${bookId}: ${err.message}`);
        // Don't delete from live if warehouse write failed — data is safe
      }
    }
  }

  // Log migration result to system_config
  if (!DRY_RUN) {
    await db.collection('system_config').updateOne(
      { _id: 'warehouse_migration' },
      { $set: {
        last_run: new Date(),
        books_moved: movedBooks,
        pages_moved: movedPages,
        errors,
      }},
      { upsert: true }
    );
  }

  // Verify counts
  const liveBooks = await db.collection('books').estimatedDocumentCount();
  const warehouseBooks = await db.collection('books_warehouse').estimatedDocumentCount();
  const livePages = await db.collection('pages').estimatedDocumentCount();
  const warehousePages = await db.collection('pages_warehouse').estimatedDocumentCount();

  console.log(`
[warehouse-migration] ${DRY_RUN ? 'DRY RUN ' : ''}Complete!
  Books moved:    ${movedBooks}
  Pages moved:    ${movedPages}
  Errors:         ${errors}

  Live books:     ${liveBooks}
  Warehouse books: ${warehouseBooks}
  Live pages:     ${livePages}
  Warehouse pages: ${warehousePages}
`);

  await client.close();
}

run().catch(e => { console.error(e); process.exit(1); });
