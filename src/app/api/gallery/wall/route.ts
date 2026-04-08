import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * GET /api/gallery/wall
 *
 * Returns a compact manifest of all gallery images for the Image Wall.
 * Optimized for size: short field names, no nulls, no metadata.
 * Sorted by book_year (oldest first) for chronological flow.
 *
 * Response: { images: Array<{ id, t, w, h, b, y }>, total }
 *   id = gallery_images.id (pageId-detectionIndex)
 *   t  = thumbnail_url
 *   w  = extracted_width
 *   h  = extracted_height
 *   b  = book_title
 *   y  = book_year
 *   bi = book_id
 */
export async function GET() {
  try {
    const db = await getDb();

    // Cap at 20K images with quality filter for manageable payload
    const LIMIT = 20_000;
    const MIN_QUALITY = 0.6;

    const items = await db.collection('gallery_images')
      .find(
        {
          gallery_quality: { $gte: MIN_QUALITY },
          book_visible: true,
          extracted_url: { $ne: null },
          thumbnail_url: { $ne: null },
        },
        {
          projection: {
            _id: 0,
            id: 1,
            thumbnail_url: 1,
            extracted_width: 1,
            extracted_height: 1,
            book_title: 1,
            book_year: 1,
            book_id: 1,
            description: 1,
          },
          maxTimeMS: 30000,
        }
      )
      .sort({ book_year: 1, book_id: 1, page_number: 1 })
      .limit(LIMIT)
      .toArray();

    // Get total count for display
    const total = await db.collection('gallery_images').estimatedDocumentCount();

    // Compact format — short field names to minimize payload
    const images = items.map(doc => ({
      id: doc.id as string,
      t: doc.thumbnail_url as string,
      w: (doc.extracted_width as number) || 200,
      h: (doc.extracted_height as number) || 280,
      b: doc.book_title as string,
      y: doc.book_year as number | undefined,
      bi: doc.book_id as string,
      d: doc.description as string | undefined,
    }));

    return NextResponse.json(
      { images, total },
      {
        headers: {
          'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
        },
      }
    );
  } catch (error) {
    console.error('Gallery wall error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch gallery wall data' },
      { status: 500 }
    );
  }
}
