import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * GET /api/gallery/featured
 *
 * Returns high-quality featured images for the homepage.
 * Selects images with gallery_quality >= 0.85, prioritizing variety.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '12'), 24);

    const db = await getDb();

    // Get high-quality images from different books for variety
    const pipeline = [
      // Match pages with high-quality detected images
      {
        $match: {
          'detected_images': { $exists: true, $ne: [] },
          $or: [
            { cropped_photo: { $exists: true, $ne: '' } },
            { photo_original: { $exists: true, $ne: '' } },
            { photo: { $exists: true, $ne: '' } }
          ]
        }
      },
      // Unwind to get individual images
      { $unwind: { path: '$detected_images', includeArrayIndex: 'detectionIndex' } },
      // Filter for high-quality images only
      {
        $match: {
          'detected_images.gallery_quality': { $gte: 0.85 },
          'detected_images.bbox': { $exists: true },
          $or: [
            { 'detected_images.detection_source': 'vision_model' },
            { 'detected_images.detection_source': 'manual' }
          ]
        }
      },
      // Lookup book info
      {
        $lookup: {
          from: 'books',
          localField: 'book_id',
          foreignField: 'id',
          as: 'book'
        }
      },
      { $unwind: { path: '$book', preserveNullAndEmptyArrays: true } },
      // Sort by quality, then randomize within quality tiers
      {
        $addFields: {
          qualityTier: {
            $cond: [
              { $gte: ['$detected_images.gallery_quality', 0.95] },
              3,
              {
                $cond: [
                  { $gte: ['$detected_images.gallery_quality', 0.9] },
                  2,
                  1
                ]
              }
            ]
          },
          randomSort: { $rand: {} }
        }
      },
      { $sort: { qualityTier: -1, randomSort: 1 } },
      // Group by book to ensure variety (max 2 per book)
      {
        $group: {
          _id: '$book_id',
          images: { $push: '$$ROOT' }
        }
      },
      // Take at most 2 images per book
      {
        $project: {
          images: { $slice: ['$images', 2] }
        }
      },
      // Unwind back to individual images
      { $unwind: '$images' },
      // Re-sort by quality
      { $sort: { 'images.qualityTier': -1, 'images.randomSort': 1 } },
      // Limit total results
      { $limit: limit },
      // Project final shape
      {
        $project: {
          id: { $concat: ['$images.id', ':', { $toString: '$images.detectionIndex' }] },
          pageId: '$images.id',
          detectionIndex: '$images.detectionIndex',
          imageUrl: { $ifNull: ['$images.cropped_photo', { $ifNull: ['$images.photo_original', '$images.photo'] }] },
          description: '$images.detected_images.description',
          type: '$images.detected_images.type',
          bbox: '$images.detected_images.bbox',
          galleryQuality: '$images.detected_images.gallery_quality',
          bookId: '$images.book_id',
          bookTitle: { $ifNull: ['$images.book.display_title', { $ifNull: ['$images.book.title', 'Unknown'] }] },
          author: '$images.book.author',
          year: '$images.book.year'
        }
      }
    ];

    const images = await db.collection('pages').aggregate(pipeline).toArray();

    return NextResponse.json({
      images,
      total: images.length
    });
  } catch (error) {
    console.error('Featured gallery error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch featured images' },
      { status: 500 }
    );
  }
}
