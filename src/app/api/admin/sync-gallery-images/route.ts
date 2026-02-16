import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const maxDuration = 300;

/**
 * POST /api/admin/sync-gallery-images
 *
 * Materializes the gallery aggregation pipeline into a flat `gallery_images` collection.
 * Each document = one image, fully denormalized with book metadata and book_rank.
 *
 * Query params:
 *   - dry_run=true: count matching images without writing
 *   - since=ISO: only sync pages updated after this timestamp (incremental)
 */
export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dryRun = searchParams.get('dry_run') === 'true';
  const since = searchParams.get('since');

  try {
    const db = await getDb();
    const startTime = Date.now();

    // Page match: must have detected_images with bbox and an image URL
    const pageMatch: Record<string, unknown> = {
      'detected_images.0': { $exists: true },
      $or: [
        { cropped_photo: { $exists: true, $ne: '' } },
        { photo_original: { $exists: true, $ne: '' } },
        { photo: { $exists: true, $ne: '' } },
      ],
      detected_images: {
        $elemMatch: {
          bbox: { $exists: true },
          detection_source: { $in: ['vision_model', 'manual', 'ocr_tag'] },
          gallery_quality: { $gte: 0.5 },
        },
      },
    };

    if (since) {
      pageMatch.image_extraction_updated_at = { $gte: new Date(since) };
    }

    const pipeline: object[] = [
      { $match: pageMatch },

      // Lookup book info
      { $lookup: { from: 'books', localField: 'book_id', foreignField: 'id', as: 'book' } },
      { $unwind: { path: '$book', preserveNullAndEmptyArrays: true } },

      // Strip to needed fields before unwind
      {
        $project: {
          id: 1, book_id: 1, page_number: 1,
          cropped_photo: 1, photo_original: 1, photo: 1,
          detected_images: 1, book: 1,
        },
      },

      // Unwind to individual images
      { $unwind: { path: '$detected_images', includeArrayIndex: 'detection_index' } },

      // Post-unwind filter: only quality images with bbox
      {
        $match: {
          'detected_images.bbox': { $exists: true },
          'detected_images.detection_source': { $in: ['vision_model', 'manual', 'ocr_tag'] },
          'detected_images.gallery_quality': { $gte: 0.5 },
        },
      },

      // Compute book_rank (position within book by quality, 1 = best)
      // Use $documentNumber (not $rank) so tied quality scores get unique positions
      {
        $setWindowFields: {
          partitionBy: '$book_id',
          sortBy: { 'detected_images.gallery_quality': -1 as const },
          output: { book_rank: { $documentNumber: {} } },
        },
      },

      // Project into flat gallery_images schema
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
          book_rank: '$book_rank',
          updated_at: new Date(),
        },
      },
    ];

    if (dryRun) {
      // Count without writing
      const countPipeline = [...pipeline, { $count: 'total' }];
      const [result] = await db.collection('pages').aggregate(countPipeline, { allowDiskUse: true }).toArray();
      const total = result?.total || 0;
      return NextResponse.json({
        dry_run: true,
        total_images: total,
        duration_ms: Date.now() - startTime,
      });
    }

    // Write to gallery_images via $merge (upsert by id)
    pipeline.push({
      $merge: {
        into: 'gallery_images',
        on: 'id',
        whenMatched: 'replace',
        whenNotMatched: 'insert',
      },
    });

    await db.collection('pages').aggregate(pipeline, { allowDiskUse: true }).toArray();

    // Clean up gallery_images from deleted books
    const galleryBookIds = await db.collection('gallery_images').distinct('book_id');
    const existingBooks = await db.collection('books')
      .find({ id: { $in: galleryBookIds } }, { projection: { id: 1 } })
      .toArray();
    const existingBookIds = new Set(existingBooks.map(b => b.id as string));
    const orphanedBookIds = galleryBookIds.filter((bid: string) => !existingBookIds.has(bid));
    let orphansRemoved = 0;
    if (orphanedBookIds.length > 0) {
      const delResult = await db.collection('gallery_images').deleteMany({ book_id: { $in: orphanedBookIds } });
      orphansRemoved = delResult.deletedCount;
    }

    // Clean up gallery_images from deleted pages (book exists but page doesn't)
    const galleryPageIds = await db.collection('gallery_images').distinct('page_id');
    const existingPages = await db.collection('pages')
      .find({ id: { $in: galleryPageIds } }, { projection: { id: 1 } })
      .toArray();
    const existingPageIds = new Set(existingPages.map(p => p.id as string));
    const orphanedPageIds = galleryPageIds.filter((pid: string) => !existingPageIds.has(pid));
    let pageOrphansRemoved = 0;
    if (orphanedPageIds.length > 0) {
      const delResult = await db.collection('gallery_images').deleteMany({ page_id: { $in: orphanedPageIds } });
      pageOrphansRemoved = delResult.deletedCount;
    }

    // Count what we wrote
    const total = await db.collection('gallery_images').countDocuments();
    const duration = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      total_images: total,
      incremental: !!since,
      orphans_removed: orphansRemoved + pageOrphansRemoved,
      orphan_details: { deleted_books: orphansRemoved, deleted_pages: pageOrphansRemoved },
      duration_ms: duration,
    });
  } catch (error) {
    console.error('Sync gallery images error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sync gallery images' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/sync-gallery-images
 *
 * Check stats on the gallery_images collection.
 */
export async function GET() {
  try {
    const db = await getDb();
    const total = await db.collection('gallery_images').countDocuments();

    // Get quality distribution
    const qualityDist = await db.collection('gallery_images').aggregate([
      {
        $bucket: {
          groupBy: '$gallery_quality',
          boundaries: [0, 0.5, 0.6, 0.7, 0.8, 0.9, 1.01],
          default: 'other',
          output: { count: { $sum: 1 } },
        },
      },
    ]).toArray();

    // Get type distribution
    const typeDist = await db.collection('gallery_images').aggregate([
      { $group: { _id: '$type', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]).toArray();

    // Get latest updated_at
    const latest = await db.collection('gallery_images')
      .findOne({}, { sort: { updated_at: -1 }, projection: { updated_at: 1 } });

    return NextResponse.json({
      total,
      quality_distribution: qualityDist,
      type_distribution: typeDist.map(t => ({ type: t._id, count: t.count })),
      last_synced: latest?.updated_at || null,
    });
  } catch (error) {
    console.error('Gallery images stats error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get stats' },
      { status: 500 }
    );
  }
}
