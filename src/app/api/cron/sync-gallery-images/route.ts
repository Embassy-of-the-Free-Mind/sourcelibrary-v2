import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyCronAuth } from '@/lib/cron-auth';
import { createCronLogger } from '@/lib/cron-logger';

export const maxDuration = 300;

/**
 * GET /api/cron/sync-gallery-images
 *
 * Incremental sync: finds pages whose image_extraction_updated_at is newer than
 * the latest gallery_images.updated_at and refreshes those rows.
 * Also recomputes book_rank for affected books.
 *
 * Runs every 6 hours via vercel.json cron.
 */
export async function GET(request: NextRequest) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const logger = createCronLogger('sync-gallery-images');

  try {
    const db = await getDb();

    // Find the latest sync timestamp
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
      .limit(5000)
      .toArray();

    if (stalePages.length === 0) {
      logger.action('synced', 0);
      logger.skip('no stale pages found');
      await logger.flush();
      return NextResponse.json({
        success: true,
        synced: 0,
        message: 'No stale pages found',
        duration_ms: logger.durationMs,
      });
    }

    // Run the materialization pipeline for only these pages
    const pageIds = stalePages.map(p => p.id);
    const affectedBookIds = [...new Set(stalePages.map(p => p.book_id as string))];

    const pipeline: object[] = [
      { $match: { id: { $in: pageIds } } },
      { $lookup: { from: 'books', localField: 'book_id', foreignField: 'id', as: 'book' } },
      { $unwind: { path: '$book', preserveNullAndEmptyArrays: true } },
      { $match: { 'book.hidden': { $ne: true } } },
      {
        $project: {
          id: 1, book_id: 1, page_number: 1,
          cropped_photo: 1, photo_original: 1, photo: 1,
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
          image_url: { $ifNull: ['$cropped_photo', { $ifNull: ['$photo_original', '$photo'] }] },
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
          book_rank: 0, // placeholder, recomputed below
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

    // Delete old gallery_images for these pages first (handles removed images)
    await db.collection('gallery_images').deleteMany({ page_id: { $in: pageIds } });

    // Run the merge
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

    // Clean up gallery_images from deleted books
    const galleryBookIds = await db.collection('gallery_images').distinct('book_id');
    const existingBooks = await db.collection('books')
      .find({ id: { $in: galleryBookIds } }, { projection: { id: 1 } })
      .toArray();
    const existingBookIds = new Set(existingBooks.map(b => b.id as string));
    const orphanedBookIds = galleryBookIds.filter((bid: string) => !existingBookIds.has(bid));

    let orphansRemoved = 0;
    if (orphanedBookIds.length > 0) {
      const deleteResult = await db.collection('gallery_images').deleteMany({ book_id: { $in: orphanedBookIds } });
      orphansRemoved = deleteResult.deletedCount;
    }

    logger.setActions({
      synced: stalePages.length,
      books_updated: affectedBookIds.length,
      orphans_removed: orphansRemoved,
      orphaned_books: orphanedBookIds.length,
    });

    await logger.flush();

    return NextResponse.json({
      success: true,
      synced: stalePages.length,
      books_updated: affectedBookIds.length,
      orphans_removed: orphansRemoved,
      orphaned_books: orphanedBookIds.length,
      duration_ms: logger.durationMs,
    });
  } catch (error) {
    console.error('Cron sync-gallery-images error:', error);
    logger.error(error instanceof Error ? error.message : 'Failed to sync gallery images');
    logger.setFailed();
    await logger.flush();
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sync gallery images' },
      { status: 500 }
    );
  }
}
