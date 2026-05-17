#!/usr/bin/env node
/**
 * cleanup-dead-pages.mjs
 *
 * Marks pages that have failed archiving >= 3 times as "blocked"
 * so the archive-ocr worker stops retrying them on every cron run.
 *
 * Also optionally reconciles book.pages_count for books where trailing
 * dead pages were ghost rows imported from IA imagecount metadata.
 *
 * Schema reference (archive-ocr.mjs):
 *   archive_metadata.failure_count          — incremented by $inc on each failure
 *   archive_metadata.last_failure_reason    — last error message
 *   archive_metadata.last_failure_at        — timestamp (sparse index exists on pages)
 *   archive_metadata.last_failure_source_url — URL that failed
 *   archive_metadata.blocked                — set here; archive-ocr.mjs filters $ne:true
 *   archive_metadata.blocked_reason         — human-readable reason
 *   archive_metadata.blocked_at             — timestamp of this cleanup run
 *
 * Index notes (as of 2026-05-17):
 *   pages             — sparse index on archive_metadata.last_failure_at (fast queries)
 *   pages_warehouse   — NO archive_metadata index (full scan times out; skip unless added)
 *
 * Usage:
 *   node scripts/maintenance/cleanup-dead-pages.mjs          # dry-run (default)
 *   node scripts/maintenance/cleanup-dead-pages.mjs --dry-run
 *   node scripts/maintenance/cleanup-dead-pages.mjs --execute
 *   node scripts/maintenance/cleanup-dead-pages.mjs --execute --reconcile-counts
 *   node scripts/maintenance/cleanup-dead-pages.mjs --include-warehouse  # adds pages_warehouse
 *
 * Safety:
 *   - NEVER deletes pages or books — only sets metadata flags
 *   - --execute must be explicitly passed; dry-run is the default
 *   - --reconcile-counts adjusts pages_count down by the number of dead
 *     pages per book; gated separately so marking can be reviewed first
 *   - pages_warehouse is skipped by default (no index → full scan → timeout)
 *     Pass --include-warehouse only after creating the index:
 *       db.pages_warehouse.createIndex({"archive_metadata.last_failure_at":1},{sparse:true})
 *
 * Run from Hetzner:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/cleanup-dead-pages.mjs [--execute] [--reconcile-counts]
 */

import { MongoClient } from 'mongodb';

const DRY_RUN = !process.argv.includes('--execute');
const RECONCILE_COUNTS = process.argv.includes('--reconcile-counts');
const INCLUDE_WAREHOUSE = process.argv.includes('--include-warehouse');
const FAILURE_THRESHOLD = 3; // Mark blocked after this many failures

// NDL Japan HTTP 500s may be transient (server overload, not dead URLs).
// Tag them with a distinct reason so they can be reviewed separately.
const NDL_DOMAIN = 'dl.ndl.go.jp';

function classifyReason(page) {
  const url = page.archive_metadata?.last_failure_source_url || page.photo || '';
  if (url.includes(NDL_DOMAIN)) return 'persistent_5xx_ndl_may_be_transient';
  return 'persistent_4xx_5xx';
}

async function processCollection(db, pagesCol, booksCol, label, dryRun, reconcileCounts) {
  console.log(`--- ${label.toUpperCase()} COLLECTION (${pagesCol}) ---`);

  // Use the sparse index on last_failure_at to find pages that have had at least
  // one failure — this is fast. Filter by failure_count >= threshold within that set.
  // This avoids a full collection scan, which times out on large collections.
  const withAnyFailure = {
    'archive_metadata.last_failure_at': { $exists: true },
    'archive_metadata.blocked': { $ne: true },  // Don't re-block already-blocked
    archived_photo: { $exists: false },
  };

  let allFailedPages;
  try {
    allFailedPages = await db.collection(pagesCol)
      .find(withAnyFailure, {
        projection: {
          _id: 1,
          book_id: 1,
          page_number: 1,
          photo: 1,
          'archive_metadata.failure_count': 1,
          'archive_metadata.last_failure_reason': 1,
          'archive_metadata.last_failure_source_url': 1,
        },
      })
      .maxTimeMS(60_000)
      .toArray();
  } catch (err) {
    console.log(`  SKIP: query timed out or failed (${err.message?.slice(0, 100)})`);
    console.log(`  To enable ${pagesCol}, create: db.${pagesCol}.createIndex({"archive_metadata.last_failure_at":1},{sparse:true})`);
    return { deadPages: 0, blocked: 0, booksWithDeadPages: 0, booksReconciled: 0, countDelta: 0 };
  }

  // Filter to threshold
  const deadPages = allFailedPages.filter(p => (p.archive_metadata?.failure_count || 0) >= FAILURE_THRESHOLD);

  console.log(`  Pages with any failure trace: ${allFailedPages.length}`);
  console.log(`  Dead pages (failure_count>=${FAILURE_THRESHOLD}, unarchived, not blocked): ${deadPages.length}`);

  if (deadPages.length === 0) {
    console.log(`  Nothing to do.\n`);
    return { deadPages: 0, blocked: 0, booksWithDeadPages: 0, booksReconciled: 0, countDelta: 0 };
  }

  // Group by book
  const byBook = new Map();
  for (const p of deadPages) {
    if (!byBook.has(p.book_id)) byBook.set(p.book_id, []);
    byBook.get(p.book_id).push(p);
  }

  console.log(`  Affects ${byBook.size} books`);

  // Show all (or top 20) offenders
  const bookList = [...byBook.entries()].sort((a, b) => b[1].length - a[1].length);
  const displayN = Math.min(20, bookList.length);
  console.log(`  Books (top ${displayN}):`);
  for (const [bookId, pages] of bookList.slice(0, displayN)) {
    const sample = pages[0];
    const isNdl = pages.some(p => (p.archive_metadata?.last_failure_source_url || '').includes(NDL_DOMAIN));
    const tag = isNdl ? ' [NDL-may-be-transient]' : '';
    const maxFc = Math.max(...pages.map(p => p.archive_metadata?.failure_count || 0));
    const reason = sample.archive_metadata?.last_failure_reason?.slice(0, 60) || 'unknown';
    console.log(`    ${bookId}: ${pages.length} dead pages, max_fc=${maxFc}, reason="${reason}"${tag}`);
  }
  if (bookList.length > displayN) console.log(`    ... and ${bookList.length - displayN} more books`);
  console.log('');

  // ---- Phase 2: Mark blocked ----
  const blockedAt = new Date();
  let blockedCount = 0;

  if (!dryRun) {
    const deadIds = deadPages.map(p => p._id);
    // Use bulk update — match by _id set for precision
    // MongoDB updateMany with $in on _id is fast (uses _id index)
    const result = await db.collection(pagesCol).updateMany(
      {
        _id: { $in: deadIds },
        'archive_metadata.blocked': { $ne: true },
      },
      {
        $set: {
          'archive_metadata.blocked': true,
          'archive_metadata.blocked_reason': 'persistent_4xx_5xx',
          'archive_metadata.blocked_at': blockedAt,
        },
      },
      { maxTimeMS: 60_000 }
    );
    blockedCount = result.modifiedCount;
    console.log(`  [EXECUTE] Marked ${blockedCount} pages as blocked in ${pagesCol}`);
  } else {
    blockedCount = deadPages.length;
    console.log(`  [DRY RUN] Would mark ${deadPages.length} pages as blocked in ${pagesCol}`);
  }

  // ---- Phase 3: Reconcile pages_count ----
  let booksReconciled = 0;
  let totalCountDelta = 0;

  if (reconcileCounts && byBook.size > 0) {
    console.log(`\n  Reconciling pages_count for ${byBook.size} books...`);

    for (const [bookId, deadPagesForBook] of byBook.entries()) {
      const book = await db.collection(booksCol).findOne(
        { id: bookId },
        { projection: { id: 1, title: 1, pages_count: 1, pages_archived: 1, archive_status: 1 } }
      );
      if (!book) {
        console.log(`    SKIP: book ${bookId} not found in ${booksCol}`);
        continue;
      }

      const oldCount = book.pages_count || 0;
      const deadCount = deadPagesForBook.length;
      const newCount = Math.max(0, oldCount - deadCount);
      const delta = oldCount - newCount;

      if (delta === 0) {
        console.log(`    SKIP: ${bookId} (dead=${deadCount}, pages_count=${oldCount}, no delta)`);
        continue;
      }

      // After reconcile: if all non-dead pages are archived, book becomes "complete"
      const remainingUnarchived = (oldCount - deadCount) - (book.pages_archived || 0);
      const willBeComplete = remainingUnarchived <= 0;

      const mode = dryRun ? '[DRY RUN]' : '[EXECUTE]';
      console.log(`    ${mode} ${bookId} "${(book.title || '').slice(0, 50)}": pages_count ${oldCount} -> ${newCount} (-${delta})${willBeComplete ? ' -> COMPLETE' : ''}`);

      if (!dryRun) {
        const updateFields = {
          pages_count: newCount,
          pages_count_reconciled_at: blockedAt,
          pages_count_reconcile_reason: 'dead_pages_cleanup',
          updated_at: blockedAt,
        };
        if (willBeComplete) {
          updateFields.archive_status = 'archive_complete';
          updateFields.archive_completed_at = blockedAt;
        }
        await db.collection(booksCol).updateOne(
          { id: bookId },
          { $set: updateFields },
          { maxTimeMS: 10_000 }
        );
      }

      booksReconciled++;
      totalCountDelta += delta;
    }
    console.log('');
  }

  return {
    deadPages: deadPages.length,
    blocked: blockedCount,
    booksWithDeadPages: byBook.size,
    booksReconciled,
    countDelta: totalCountDelta,
  };
}

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('ERROR: MONGODB_URI not set. Source .env.production.local first.');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log(DRY_RUN ? 'MODE: DRY RUN (no writes)' : 'MODE: EXECUTE (writing to production)');
  if (RECONCILE_COUNTS) console.log('      + --reconcile-counts: will adjust pages_count');
  if (INCLUDE_WAREHOUSE) console.log('      + --include-warehouse: will process pages_warehouse');
  console.log(`Failure threshold: ${FAILURE_THRESHOLD}`);
  console.log('='.repeat(60));
  console.log('');

  const client = await MongoClient.connect(process.env.MONGODB_URI, { maxPoolSize: 3 });
  const db = client.db('bookstore');

  const collections = [
    { pages: 'pages', books: 'books', label: 'live' },
  ];
  if (INCLUDE_WAREHOUSE) {
    // Only attempt warehouse if explicitly requested AND index should exist
    collections.push({ pages: 'pages_warehouse', books: 'books_warehouse', label: 'warehouse' });
  } else {
    console.log('Skipping pages_warehouse (no archive_metadata index — would timeout).');
    console.log('Add --include-warehouse after creating the index on pages_warehouse.\n');
  }

  let totalDeadPages = 0;
  let totalBlocked = 0;
  let totalBooksWithDeadPages = 0;
  let totalBooksReconciled = 0;
  let totalPagesCountDelta = 0;

  for (const col of collections) {
    const result = await processCollection(db, col.pages, col.books, col.label, DRY_RUN, RECONCILE_COUNTS);
    totalDeadPages += result.deadPages;
    totalBlocked += result.blocked;
    totalBooksWithDeadPages += result.booksWithDeadPages;
    totalBooksReconciled += result.booksReconciled;
    totalPagesCountDelta += result.countDelta;
  }

  // ---- Summary ----
  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`  Dead pages found (failure_count>=${FAILURE_THRESHOLD}): ${totalDeadPages}`);
  console.log(`  ${DRY_RUN ? 'Would be marked' : 'Marked'} blocked:               ${totalBlocked}`);
  console.log(`  Books affected:                        ${totalBooksWithDeadPages}`);
  if (RECONCILE_COUNTS) {
    console.log(`  Books with pages_count updated:        ${totalBooksReconciled}`);
    console.log(`  Total pages_count reduction:           ${totalPagesCountDelta}`);
  }

  if (DRY_RUN) {
    console.log('');
    console.log('This was a DRY RUN. Re-run with --execute to apply changes.');
    if (!RECONCILE_COUNTS) {
      console.log('Add --reconcile-counts to also adjust book.pages_count.');
    }
    if (!INCLUDE_WAREHOUSE) {
      console.log('Add --include-warehouse (after creating the index) for warehouse pages.');
    }
  }

  if (!DRY_RUN) {
    console.log('');
    console.log('NEXT STEPS:');
    console.log('  1. archive-ocr.mjs page-fetch query already includes');
    console.log('     archive_metadata.blocked: { $ne: true } (added 2026-05-17).');
    console.log('  2. For pages_warehouse, create the sparse index then re-run');
    console.log('     with --include-warehouse.');
    console.log('  3. If --reconcile-counts was NOT used, run again with that flag');
    console.log('     after reviewing the book list above.');
  }

  await client.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
