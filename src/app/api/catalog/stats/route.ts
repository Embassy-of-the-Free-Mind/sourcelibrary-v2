import { NextResponse } from 'next/server';
import { parseCatalogFilters } from '@/lib/catalog/filters';
import { catalogStats } from '@/lib/catalog/query';

export const maxDuration = 30;

/**
 * GET /api/catalog/stats — exact numbers for the catalogue's stats band:
 * works, translated, languages, and when they were printed, over exactly the
 * set /api/catalog/results lists for the same parameters (both go through
 * applyCatalogFilters). Cached an hour per filter set.
 */
export async function GET(request: Request) {
  const filters = parseCatalogFilters(new URL(request.url).searchParams);
  try {
    const stats = await catalogStats(filters);
    return NextResponse.json(stats, {
      headers: { 'Cache-Control': 'public, max-age=0, s-maxage=600, stale-while-revalidate=3600' },
    });
  } catch (err) {
    console.error('[catalog/stats]', (err as Error)?.message);
    return NextResponse.json({ error: 'Failed to count the catalogue' }, { status: 500 });
  }
}
