import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

// In-memory cache (1 hour TTL)
const CACHE_TTL_MS = 60 * 60 * 1000;
let cachedResult: { data: unknown; timestamp: number } | null = null;

const EMPTY_RESPONSE = {
  totals: { entities: 0, with_dates: 0, with_coordinates: 0, with_wikidata: 0, books: 0 },
  type_distribution: {},
  heatmap: [],
  top_entities_by_era: [],
  data_sources: {},
};

/**
 * GET /api/explore/stats
 *
 * Serves pre-computed snapshot from system_config. All expensive
 * aggregations run offline via scripts/_tmp-seed-explore-stats.mjs.
 * The entities collection (499K docs) is too large for live queries.
 */
export async function GET() {
  try {
    if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_TTL_MS) {
      return NextResponse.json(cachedResult.data, {
        headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
      });
    }

    const db = await getDb();
    const snapshot = await db.collection('system_config').findOne(
      { _id: 'explore_stats_snapshot' } as any,
      { maxTimeMS: 5000 },
    );

    const data = snapshot?.data ?? EMPTY_RESPONSE;
    cachedResult = { data, timestamp: Date.now() };

    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
    });
  } catch (error) {
    console.error('Error fetching explore stats:', error);
    return NextResponse.json(EMPTY_RESPONSE, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30' },
    });
  }
}
