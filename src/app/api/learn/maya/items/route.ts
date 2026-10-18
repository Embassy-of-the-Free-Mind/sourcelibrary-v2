import { NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { ITEMS_COLLECTION } from '@/lib/learn-maya';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

/**
 * GET /api/learn/maya/items — the whole /learn/maya bank (#6921), ~150 items.
 * Public: every field is material already on the site (crops of a public leaf,
 * dictionary lines, source lines). Retired items are left out.
 */
export async function GET() {
  const db = await getReadDb();
  const items = await db
    .collection(ITEMS_COLLECTION)
    .find({ status: { $in: ['live', 'heldout'] } }, { projection: { provenance: 0, created_at: 0, updated_at: 0, review: 0 } })
    .sort({ rung: 1, order: 1 })
    .toArray();
  return NextResponse.json(
    { items },
    { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=600, stale-while-revalidate=86400' } },
  );
}
