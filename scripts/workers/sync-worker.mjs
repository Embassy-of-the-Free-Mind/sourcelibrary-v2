#!/usr/bin/env node
/**
 * Sync Worker
 *
 * Replaces the Vercel `sync-page-counts` and `sync-gallery-images` crons.
 * Runs with no time limit.
 *
 * Designed to run every 2 hours on Hetzner via crontab.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/workers/sync-worker.mjs
 *   node scripts/workers/sync-worker.mjs --dry-run
 *   node scripts/workers/sync-worker.mjs --counts-only
 *   node scripts/workers/sync-worker.mjs --gallery-only
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const COUNTS_ONLY = args.includes('--counts-only');
const GALLERY_ONLY = args.includes('--gallery-only');

console.log(`[sync-worker] Dry run: ${DRY_RUN}${COUNTS_ONLY ? ' | Counts only' : ''}${GALLERY_ONLY ? ' | Gallery only' : ''}`);

// ── Sync Page Counts ──

async function syncPageCounts(db) {
  console.log('\n--- Sync Page Counts ---');
  const start = Date.now();

  // Single aggregation: count OCR and translation pages per book
  const pageStats = await db.collection('pages').aggregate([
    {
      $group: {
        _id: '$book_id',
        pages_count: { $sum: 1 },
        pages_ocr: {
          $sum: {
            $cond: [
              { $and: [
                { $eq: [{ $type: '$ocr.data' }, 'string'] },
                { $gt: [{ $strLenCP: '$ocr.data' }, 0] },
              ] },
              1, 0,
            ],
          },
        },
        pages_translated: {
          $sum: {
            $cond: [
              { $or: [
                { $and: [
                  { $eq: [{ $type: '$translation.data' }, 'string'] },
                  { $gt: [{ $strLenCP: '$translation.data' }, 0] },
                ] },
                // Blank pages don't need translation — count as done
                { $eq: [{ $ifNull: ['$page_type', ''] }, 'blank'] },
              ] },
              1, 0,
            ],
          },
        },
      },
    },
  ]).toArray();

  const statsMap = new Map();
  for (const stat of pageStats) {
    statsMap.set(stat._id, {
      pages_count: stat.pages_count,
      pages_ocr: stat.pages_ocr,
      pages_translated: stat.pages_translated,
    });
  }

  // Fetch all books' cached values
  const books = await db.collection('books')
    .find({}, { projection: { _id: 1, id: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1 } })
    .toArray();

  // Build bulk updates for mismatches
  const bulkOps = [];
  let mismatchCount = 0;

  for (const book of books) {
    const bookId = book.id || book._id?.toString();
    const actual = statsMap.get(bookId) || { pages_count: 0, pages_ocr: 0, pages_translated: 0 };
    const current = {
      pages_count: book.pages_count || 0,
      pages_ocr: book.pages_ocr || 0,
      pages_translated: book.pages_translated || 0,
    };

    if (
      current.pages_count !== actual.pages_count ||
      current.pages_ocr !== actual.pages_ocr ||
      current.pages_translated !== actual.pages_translated
    ) {
      mismatchCount++;
      if (!DRY_RUN) {
        bulkOps.push({
          updateOne: {
            filter: { _id: book._id },
            update: {
              $set: {
                pages_count: actual.pages_count,
                pages_ocr: actual.pages_ocr,
                pages_translated: actual.pages_translated,
                updated_at: new Date(),
              },
            },
          },
        });
      }
    }
  }

  let updated = 0;
  if (bulkOps.length > 0) {
    const result = await db.collection('books').bulkWrite(bulkOps);
    updated = result.modifiedCount;
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`  Books checked: ${books.length} | Mismatches: ${mismatchCount} | Updated: ${updated} | ${elapsed}s`);

  return { books_checked: books.length, mismatches: mismatchCount, updated };
}

// ── Sync Gallery Images ──

async function syncGalleryImages(db) {
  console.log('\n--- Sync Gallery Images ---');
  const start = Date.now();

  // Find latest sync timestamp
  const latestDoc = await db.collection('gallery_images')
    .findOne({}, { sort: { updated_at: -1 }, projection: { updated_at: 1 } });
  const since = latestDoc?.updated_at || new Date(0);

  // Find pages updated since last sync
  const stalePages = await db.collection('pages')
    .find(
      {
        image_extraction_updated_at: { $gt: since },
        'detected_images.0': { $exists: true },
      },
      { projection: { id: 1, book_id: 1 } }
    )
    .limit(10000) // Higher limit than Vercel cron
    .toArray();

  if (stalePages.length === 0) {
    console.log('  No stale pages found');
    return { synced: 0, books_updated: 0, orphans_removed: 0 };
  }

  const pageIds = stalePages.map(p => p.id);
  const affectedBookIds = [...new Set(stalePages.map(p => p.book_id))];

  console.log(`  Stale pages: ${stalePages.length} across ${affectedBookIds.length} books`);

  if (DRY_RUN) {
    return { synced: stalePages.length, books_updated: affectedBookIds.length, orphans_removed: 0 };
  }

  // Delete old gallery_images for these pages (handles removed images)
  await db.collection('gallery_images').deleteMany({ page_id: { $in: pageIds } });

  // Materialization pipeline
  const pipeline = [
    { $match: { id: { $in: pageIds } } },
    { $lookup: { from: 'books', localField: 'book_id', foreignField: 'id', as: 'book' } },
    { $unwind: { path: '$book', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        id: 1, book_id: 1, page_number: 1,
        cropped_photo: 1, archived_photo: 1, photo_original: 1, photo: 1,
        detected_images: 1, book: 1,
      },
    },
    { $unwind: { path: '$detected_images', includeArrayIndex: 'detection_index' } },
    {
      $match: {
        'detected_images.bbox': { $exists: true },
        'detected_images.detection_source': { $in: ['vision_model', 'manual', 'ocr_tag'] },
        'detected_images.gallery_quality': { $gte: 0.5 },
      },
    },
    {
      $project: {
        _id: 0,
        id: { $concat: ['$id', '-', { $toString: '$detection_index' }] },
        page_id: '$id',
        book_id: '$book_id',
        page_number: '$page_number',
        detection_index: '$detection_index',
        image_url: { $ifNull: ['$cropped_photo', { $ifNull: ['$archived_photo', { $ifNull: ['$photo_original', '$photo'] }] }] },
        thumbnail_url: '$detected_images.thumbnail_url',
        extracted_url: '$detected_images.extracted_url',
        description: { $ifNull: ['$detected_images.description', ''] },
        type: '$detected_images.type',
        bbox: '$detected_images.bbox',
        rotation: '$detected_images.rotation',
        gallery_quality: '$detected_images.gallery_quality',
        confidence: '$detected_images.confidence',
        museum_description: '$detected_images.museum_description',
        detection_source: '$detected_images.detection_source',
        metadata: '$detected_images.metadata',
        book_title: { $ifNull: ['$book.display_title', { $ifNull: ['$book.title', 'Unknown'] }] },
        book_author: '$book.author',
        book_year: '$book.year',
        book_language: '$book.language',
        book_hidden: '$book.hidden',
        book_rank: 0,
        updated_at: new Date(),
      },
    },
    {
      $merge: {
        into: 'gallery_images',
        on: 'id',
        whenMatched: 'replace',
        whenNotMatched: 'insert',
      },
    },
  ];

  await db.collection('pages').aggregate(pipeline, { allowDiskUse: true }).toArray();

  // Recompute book_rank for affected books
  for (const bookId of affectedBookIds) {
    const bookImages = await db.collection('gallery_images')
      .find({ book_id: bookId })
      .sort({ gallery_quality: -1 })
      .toArray();

    const ops = bookImages.map((img, idx) => ({
      updateOne: {
        filter: { id: img.id },
        update: { $set: { book_rank: idx + 1 } },
      },
    }));

    if (ops.length > 0) {
      await db.collection('gallery_images').bulkWrite(ops);
    }
  }

  // Cleanup orphans from deleted books
  const galleryBookIds = await db.collection('gallery_images').distinct('book_id');
  const existingBooks = await db.collection('books')
    .find({ id: { $in: galleryBookIds } }, { projection: { id: 1 } })
    .toArray();
  const existingBookIds = new Set(existingBooks.map(b => b.id));
  const orphanedBookIds = galleryBookIds.filter(bid => !existingBookIds.has(bid));

  let orphansRemoved = 0;
  if (orphanedBookIds.length > 0) {
    const deleteResult = await db.collection('gallery_images').deleteMany({ book_id: { $in: orphanedBookIds } });
    orphansRemoved = deleteResult.deletedCount;
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`  Synced: ${stalePages.length} | Books updated: ${affectedBookIds.length} | Orphans removed: ${orphansRemoved} | ${elapsed}s`);

  return { synced: stalePages.length, books_updated: affectedBookIds.length, orphans_removed: orphansRemoved };
}

// ── Main ──

async function run() {
  const startTime = Date.now();
  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  let countsResult = {};
  let galleryResult = {};

  if (!GALLERY_ONLY) {
    countsResult = await syncPageCounts(db);
  }

  if (!COUNTS_ONLY) {
    galleryResult = await syncGalleryImages(db);
  }

  const duration = Date.now() - startTime;

  console.log(`\n=== SYNC COMPLETE (${(duration / 1000).toFixed(1)}s) ===`);

  // Write cron_runs record
  if (!DRY_RUN) {
    await db.collection('cron_runs').insertOne({
      cron: 'sync-worker',
      timestamp: new Date(),
      duration_ms: duration,
      status: 'success',
      failed: false,
      actions: {
        ...countsResult,
        gallery_synced: galleryResult.synced || 0,
        gallery_books_updated: galleryResult.books_updated || 0,
        gallery_orphans_removed: galleryResult.orphans_removed || 0,
      },
      errors: [],
      error_count: 0,
      summary: `Counts: ${countsResult.mismatches || 0} mismatches, ${countsResult.updated || 0} updated. Gallery: ${galleryResult.synced || 0} pages synced.`,
    }).catch(() => {});
  }

  await client.close();
}

run().catch(err => { console.error(err); process.exit(1); });
