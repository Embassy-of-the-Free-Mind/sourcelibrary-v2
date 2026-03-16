import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const preferredRegion = 'fra1';

/**
 * POST /api/pages/batch
 *
 * Fetch multiple pages by ID in a single request.
 * Body: { ids: string[] }
 * Returns: { pages: Page[] }
 *
 * Used by the reader to prefetch adjacent pages without
 * firing N individual requests (which triggers rate limiting).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const ids: string[] = body.ids;

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'ids array is required' }, { status: 400 });
    }

    // Cap at 20 pages per request
    const limitedIds = ids.slice(0, 20);

    const db = await getDb();
    const pages = await db.collection('pages').find(
      { id: { $in: limitedIds } },
      { projection: { detected_images: 0 } }
    ).toArray();

    // Strip MongoDB _id
    const cleaned = pages.map(({ _id, ...rest }) => rest);

    return NextResponse.json({ pages: cleaned }, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    });
  } catch (error) {
    console.error('Batch pages error:', error);
    return NextResponse.json({ error: 'Failed to fetch pages' }, { status: 500 });
  }
}
