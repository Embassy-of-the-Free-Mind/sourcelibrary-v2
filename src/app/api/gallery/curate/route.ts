import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * POST /api/gallery/curate
 *
 * Batch apply curation decisions to gallery images.
 *
 * Body: {
 *   upvoteIds?: string[]    — boost gallery_quality by 0.1, set curated: true
 *   downvoteIds?: string[]  — reduce gallery_quality by 0.15, set curated_down: true
 * }
 *
 * Image IDs are in "pageId:detectionIndex" format.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { upvoteIds, downvoteIds, imageIds } = body;

    // Backwards compat: imageIds = upvoteIds
    const ups: string[] = upvoteIds || imageIds || [];
    const downs: string[] = downvoteIds || [];

    if (ups.length === 0 && downs.length === 0) {
      return NextResponse.json(
        { error: 'upvoteIds or downvoteIds array is required' },
        { status: 400 }
      );
    }

    if (ups.length + downs.length > 10000) {
      return NextResponse.json(
        { error: 'Maximum 10,000 images per request' },
        { status: 400 }
      );
    }

    const db = await getDb();
    const col = db.collection('gallery_images');
    let upMatched = 0, upModified = 0, downMatched = 0, downModified = 0;

    // gallery_images uses `id` field in "pageId-detectionIndex" format (dash, not colon)
    // likes use "pageId:detectionIndex" (colon) — normalize to gallery_images format

    if (ups.length > 0) {
      const galleryIds = ups.map((id: string) => id.replace(':', '-'));
      const result = await col.updateMany(
        { id: { $in: galleryIds } },
        [
          {
            $set: {
              curated: true,
              curated_at: new Date(),
              gallery_quality: {
                $min: [1.0, { $add: [{ $ifNull: ['$gallery_quality', 0.5] }, 0.1] }],
              },
            },
          },
        ]
      );
      upMatched = result.matchedCount;
      upModified = result.modifiedCount;
    }

    if (downs.length > 0) {
      const galleryIds = downs.map((id: string) => id.replace(':', '-'));
      const result = await col.updateMany(
        { id: { $in: galleryIds } },
        [
          {
            $set: {
              curated_down: true,
              curated_at: new Date(),
              gallery_quality: {
                $max: [0.0, { $subtract: [{ $ifNull: ['$gallery_quality', 0.5] }, 0.15] }],
              },
            },
          },
        ]
      );
      downMatched = result.matchedCount;
      downModified = result.modifiedCount;
    }

    return NextResponse.json({
      success: true,
      upvotes: { matched: upMatched, modified: upModified },
      downvotes: { matched: downMatched, modified: downModified },
    });
  } catch (error) {
    console.error('Curate error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to apply curation' },
      { status: 500 }
    );
  }
}
