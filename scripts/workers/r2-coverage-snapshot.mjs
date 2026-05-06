#!/usr/bin/env node
/**
 * R2 Coverage Snapshot Worker
 *
 * Aggregates per-book R2 archive state across the pages collection and writes
 * the result to system_config._id: 'r2_coverage_snapshot'. The /admin/r2-coverage
 * page reads this doc instead of running 5M-row regex aggregations on every load.
 *
 * Run on demand or via Hetzner cron (every 6h is plenty — coverage changes slowly).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/workers/r2-coverage-snapshot.mjs
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const R2_HOST_REGEX = /^https:\/\/images\.sourcelibrary\.org/;
const ARCHIVE_FAILED_REGEX = /^failed:/;

async function run() {
  const client = new MongoClient(MONGODB_URI, { socketTimeoutMS: 1800000 });
  await client.connect();
  const db = client.db('bookstore');
  const start = Date.now();

  console.log(`[r2-coverage-snapshot] Starting at ${new Date().toISOString()}`);

  // Single aggregation: per-book R2 state across the whole pages collection.
  // $regexMatch is acceptable here because it's run once per book per snapshot,
  // not on every admin page load.
  console.log('  aggregating pages by book_id (this can take 10-20 min on Atlas)...');
  const perBook = await db.collection('pages').aggregate([
    { $group: {
      _id: '$book_id',
      total: { $sum: 1 },
      r2: { $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ['$archived_photo', ''] }, regex: R2_HOST_REGEX } }, 1, 0] } },
      failed: { $sum: { $cond: [{ $regexMatch: { input: { $ifNull: ['$archived_photo', ''] }, regex: ARCHIVE_FAILED_REGEX } }, 1, 0] } },
    }},
  ], { allowDiskUse: true, maxTimeMS: 1800000 }).toArray();

  console.log(`  per-book aggregation done: ${perBook.length} books with pages, ${((Date.now() - start)/60000).toFixed(1)} min`);

  const statsByBook = new Map(perBook.map(s => [s._id, s]));

  // Pull book metadata in one pass — only what we need
  const books = await db.collection('books').find(
    { status: { $ne: 'deleted' }, pages_count: { $gt: 0 } },
    { projection: { id: 1, title: 1, language: 1, 'image_source.provider': 1, 'pipeline_auto.status': 1, 'pipeline_auto.error': 1 } }
  ).toArray();

  // Bucket books by R2 coverage
  const buckets = { full: 0, partial_high: 0, partial_med: 0, partial_low: 0, none: 0 };
  let totalPages = 0;
  let totalR2 = 0;
  let totalFailed = 0;
  const byProvider = {};
  const byProviderUnarchived = {};
  const partialBooks = []; // books with some-but-not-all R2 coverage
  const noR2Books = [];    // books with zero R2 coverage but >0 pages

  for (const b of books) {
    const s = statsByBook.get(b.id) || { total: 0, r2: 0, failed: 0 };
    if (s.total === 0) continue; // no pages doc — skip
    const provider = b.image_source?.provider || 'unknown';
    const unarchived = Math.max(0, s.total - s.r2 - s.failed);
    const ratio = s.r2 / s.total;

    totalPages += s.total;
    totalR2 += s.r2;
    totalFailed += s.failed;

    if (!byProvider[provider]) byProvider[provider] = { books: 0, pages: 0, r2: 0, failed: 0 };
    byProvider[provider].books += 1;
    byProvider[provider].pages += s.total;
    byProvider[provider].r2 += s.r2;
    byProvider[provider].failed += s.failed;
    byProviderUnarchived[provider] = (byProviderUnarchived[provider] || 0) + unarchived;

    if (ratio >= 0.99) buckets.full += 1;
    else if (ratio >= 0.5) buckets.partial_high += 1;
    else if (ratio >= 0.1) buckets.partial_med += 1;
    else if (ratio > 0) buckets.partial_low += 1;
    else buckets.none += 1;

    if (ratio > 0 && ratio < 0.99) {
      partialBooks.push({
        id: b.id,
        title: b.title,
        language: b.language,
        provider,
        status: b.pipeline_auto?.status || null,
        error: b.pipeline_auto?.error?.slice(0, 80) || null,
        pages: s.total,
        r2: s.r2,
        failed: s.failed,
        unarchived,
        pct: Math.round(ratio * 1000) / 10,
      });
    } else if (ratio === 0 && s.total > 0) {
      noR2Books.push({
        id: b.id,
        title: b.title,
        language: b.language,
        provider,
        status: b.pipeline_auto?.status || null,
        pages: s.total,
      });
    }
  }

  partialBooks.sort((a, b) => b.unarchived - a.unarchived);
  noR2Books.sort((a, b) => b.pages - a.pages);

  const snapshot = {
    _id: 'r2_coverage_snapshot',
    computed_at: new Date(),
    computation_ms: Date.now() - start,
    library: {
      books_with_pages: buckets.full + buckets.partial_high + buckets.partial_med + buckets.partial_low + buckets.none,
      total_pages: totalPages,
      r2_pages: totalR2,
      failed_pages: totalFailed,
      unarchived_pages: totalPages - totalR2 - totalFailed,
      r2_pct: totalPages > 0 ? Math.round((totalR2 / totalPages) * 1000) / 10 : 0,
    },
    coverage_buckets: buckets,
    by_provider: byProvider,
    partial_books_top200: partialBooks.slice(0, 200),
    no_r2_books_top200: noR2Books.slice(0, 200),
    partial_books_count: partialBooks.length,
    no_r2_books_count: noR2Books.length,
  };

  await db.collection('system_config').replaceOne(
    { _id: 'r2_coverage_snapshot' },
    snapshot,
    { upsert: true },
  );

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[r2-coverage-snapshot] Done in ${elapsed}s`);
  console.log(`  Library: ${snapshot.library.r2_pct}% R2 (${totalR2.toLocaleString()}/${totalPages.toLocaleString()} pages)`);
  console.log(`  Buckets: full=${buckets.full}, partial_high=${buckets.partial_high}, partial_med=${buckets.partial_med}, partial_low=${buckets.partial_low}, none=${buckets.none}`);
  console.log(`  Partial books: ${partialBooks.length} | No-R2 books: ${noR2Books.length}`);

  await client.close();
}

run().catch(err => { console.error(err); process.exit(1); });
