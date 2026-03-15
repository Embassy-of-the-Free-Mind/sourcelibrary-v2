import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * POST /api/gallery/curate — Batch apply curation decisions to gallery images.
 * PATCH /api/gallery/curate — Exclude a book from gallery showcase.
 *
 * POST Body: { upvoteIds?: string[], downvoteIds?: string[] }
 * PATCH Body: { bookId: string, galleryExclude: boolean }
 */

export async function PATCH(request: NextRequest) {
  try {
    const { bookId, galleryExclude } = await request.json();
    if (!bookId) {
      return NextResponse.json({ error: 'bookId required' }, { status: 400 });
    }

    const db = await getDb();
    await db.collection('books').updateOne(
      { $or: [{ id: bookId }, { _id: bookId }] },
      { $set: { gallery_exclude: !!galleryExclude, gallery_exclude_at: new Date() } }
    );

    // Also mark all gallery_images from this book so they don't surface
    await db.collection('gallery_images').updateMany(
      { book_id: bookId },
      { $set: { book_gallery_excluded: true } }
    );

    return NextResponse.json({ success: true, bookId, galleryExclude: !!galleryExclude });
  } catch (error) {
    console.error('Gallery exclude error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    );
  }
}
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
