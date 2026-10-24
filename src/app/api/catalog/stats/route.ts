import { NextResponse } from 'next/server';
import { parseCatalogFilters, PRINTED_BUCKETS } from '@/lib/catalog/filters';
import { catalogStats, isUpstreamBlock } from '@/lib/catalog/query';

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
    // A request the upstream firewall refuses counts nothing (see isUpstreamBlock).
    if (isUpstreamBlock(err)) {
      return NextResponse.json({
        total: 0, translated: 0, languageCount: 0, languages: [],
        printed: PRINTED_BUCKETS.map(([from, to]) => ({ from, to, count: 0 })), yearFirst: null, yearLast: null,
      });
    }
    console.error('[catalog/stats]', (err as Error)?.message);
    return NextResponse.json({ error: 'Failed to count the catalogue' }, { status: 500 });
  }
}
