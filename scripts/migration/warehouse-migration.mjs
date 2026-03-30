#!/usr/bin/env node
/**
 * Migration: Move archived books to warehouse collections.
 *
 * Uses chunked $merge to copy server-side, then bulk deletes.
 * Chunks by book ID ranges to avoid timeouts on Atlas.
 *
 * Safe to re-run — $merge with 'keepExisting' skips dupes.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/migration/warehouse-migration.mjs
 *   # Dry run (just counts):
 *   set -a; source .env.production.local; set +a; node scripts/migration/warehouse-migration.mjs --dry-run
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const DRY_RUN = process.argv.includes('--dry-run');
const WAREHOUSE_STATUSES = ['archiving', 'archive_complete'];
const BOOK_CHUNK = 1000; // Books per $merge chunk
const PAGE_CHUNK = 200; // Book IDs per page $merge chunk (page-heavy books timeout at larger sizes)

async function run() {
  const client = new MongoClient(MONGODB_URI, {
    maxPoolSize: 5,
    socketTimeoutMS: 600000, // 10 min
  });
  await client.connect();
  const db = client.db('bookstore');
  const startTime = Date.now();

  console.log(`[wh] ${DRY_RUN ? 'DRY RUN — ' : ''}Starting at ${new Date().toISOString()}`);

  // Get all book IDs to move
  const bookIds = await db.collection('books').distinct('id', {
    'pipeline_auto.status': { $in: WAREHOUSE_STATUSES }
  });
  console.log(`[wh] ${bookIds.length} books to warehouse`);

  if (bookIds.length === 0) {
    console.log('[wh] Nothing to do.');
    await client.close();
    return;
  }

  if (DRY_RUN) {
    console.log(`[wh] DRY RUN complete — would move ${bookIds.length} books`);
    await client.close();
    return;
  }

  // ── Step 1: Create indexes ──
  console.log('[wh] Creating warehouse indexes...');
  await db.collection('books_warehouse').createIndex({ id: 1 }, { unique: true }).catch(() => {});
  await db.collection('books_warehouse').createIndex({ 'pipeline_auto.status': 1 }).catch(() => {});
  await db.collection('books_warehouse').createIndex({ ia_identifier: 1 }).catch(() => {});
  await db.collection('pages_warehouse').createIndex({ book_id: 1, page_number: 1 }).catch(() => {});
  await db.collection('pages_warehouse').createIndex({ book_id: 1 }).catch(() => {});
  console.log('[wh] Indexes ready.');

  // ── Step 2: Copy books in chunks via $merge ──
  let booksCopied = 0;
  for (let i = 0; i < bookIds.length; i += BOOK_CHUNK) {
    const chunk = bookIds.slice(i, i + BOOK_CHUNK);
    await db.collection('books').aggregate([
      { $match: { id: { $in: chunk } } },
      { $merge: { into: 'books_warehouse', on: '_id', whenMatched: 'keepExisting', whenNotMatched: 'insert' } },
    ], { maxTimeMS: 300000 }).toArray();
    booksCopied += chunk.length;
    console.log(`[wh] Books copied: ${booksCopied}/${bookIds.length} (${((Date.now() - startTime) / 1000).toFixed(0)}s)`);
  }

  // ── Step 3: Copy pages in chunks via $merge ──
  let pagesPhase = Date.now();
  for (let i = 0; i < bookIds.length; i += PAGE_CHUNK) {
    const chunk = bookIds.slice(i, i + PAGE_CHUNK);

    // Skip chunks where pages are already in warehouse (re-run optimization)
    const livePagesInChunk = await db.collection('pages').countDocuments(
      { book_id: { $in: chunk } },
      { maxTimeMS: 30000 }
    );
    if (livePagesInChunk === 0) {
      console.log(`[wh] Pages chunk ${i}-${Math.min(i + PAGE_CHUNK, bookIds.length)}: 0 live pages, skipping`);
      continue;
    }

    await db.collection('pages').aggregate([
      { $match: { book_id: { $in: chunk } } },
      { $merge: { into: 'pages_warehouse', on: '_id', whenMatched: 'keepExisting', whenNotMatched: 'insert' } },
    ], { maxTimeMS: 600000 }).toArray();
    console.log(`[wh] Pages copied for books ${i}-${Math.min(i + PAGE_CHUNK, bookIds.length)}: ${livePagesInChunk} pages (${((Date.now() - pagesPhase) / 1000).toFixed(0)}s)`);
  }

  // Verify
  const whBooks = await db.collection('books_warehouse').estimatedDocumentCount();
  const whPages = await db.collection('pages_warehouse').estimatedDocumentCount();
  console.log(`[wh] Warehouse: ${whBooks} books, ~${whPages} pages`);

  // ── Step 4: Delete from live in chunks ──
  let pagesDeleted = 0;
  for (let i = 0; i < bookIds.length; i += PAGE_CHUNK) {
    const chunk = bookIds.slice(i, i + PAGE_CHUNK);
    const r = await db.collection('pages').deleteMany({ book_id: { $in: chunk } });
    pagesDeleted += r.deletedCount;
    console.log(`[wh] Pages deleted: ${pagesDeleted} (chunk ${i}-${Math.min(i + PAGE_CHUNK, bookIds.length)})`);
  }

  const booksDeleted = await db.collection('books').deleteMany({
    id: { $in: bookIds }
  });
  console.log(`[wh] Books deleted from live: ${booksDeleted.deletedCount}`);

  // ── Step 5: Log ──
  await db.collection('system_config').updateOne(
    { _id: 'warehouse_migration' },
    { $set: { last_run: new Date(), books_moved: bookIds.length, pages_moved: pagesDeleted }},
    { upsert: true }
  );

  const liveBooks = await db.collection('books').estimatedDocumentCount();
  const livePages = await db.collection('pages').estimatedDocumentCount();

  console.log(`
[wh] Complete in ${((Date.now() - startTime) / 1000).toFixed(0)}s!
  Books moved:      ${bookIds.length}
  Pages moved:      ${pagesDeleted}
  Live books:       ${liveBooks}
  Live pages:       ${livePages}
  Warehouse books:  ${whBooks}
  Warehouse pages:  ${whPages}
`);

  await client.close();
}

run().catch(e => { console.error(e); process.exit(1); });
