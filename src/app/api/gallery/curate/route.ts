import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * POST /api/gallery/curate
 *
 * Batch apply curated flag to gallery images.
 * Sets `curated: true` and boosts `gallery_quality` by 0.1 (capped at 1.0).
 *
 * Body: { imageIds: string[] }
 * Image IDs are in "pageId:detectionIndex" format.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { imageIds } = body;

    if (!Array.isArray(imageIds) || imageIds.length === 0) {
      return NextResponse.json(
        { error: 'imageIds array is required' },
        { status: 400 }
      );
    }

    if (imageIds.length > 10000) {
      return NextResponse.json(
        { error: 'Maximum 10,000 images per request' },
        { status: 400 }
      );
    }

    const db = await getDb();

    // gallery_images uses `id` field in "pageId-detectionIndex" format (dash, not colon)
    // likes use "pageId:detectionIndex" (colon) — normalize to gallery_images format
    const galleryIds = imageIds.map((id: string) => id.replace(':', '-'));

    // Set curated flag and boost quality
    const result = await db.collection('gallery_images').updateMany(
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

    return NextResponse.json({
      success: true,
      matched: result.matchedCount,
      modified: result.modifiedCount,
    });
  } catch (error) {
    console.error('Curate error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to apply curated flag' },
      { status: 500 }
    );
  }
}
