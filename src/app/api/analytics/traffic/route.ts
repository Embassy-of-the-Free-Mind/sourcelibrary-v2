import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-helpers';
import { getTrafficDashboard, type TrafficBin } from '@/lib/analytics-traffic';

export const maxDuration = 30;

// Short in-memory cache keyed by the full query (range/bin/filters). Traffic
// changes slowly and these aggregations scan the 90-day window.
const cache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

const VALID_BINS: TrafficBin[] = ['hour', 'day', 'week'];

export const GET = withAuth(async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30', 10);
    const binParam = searchParams.get('bin') as TrafficBin | null;
    const bin = binParam && VALID_BINS.includes(binParam) ? binParam : undefined;
    const filters = {
      country: searchParams.get('country') || undefined,
      section: searchParams.get('section') || undefined,
      referrer: searchParams.get('referrer') || undefined,
      host: searchParams.get('host') || undefined,
    };

    const cacheKey = JSON.stringify({ days, bin, filters });
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
      return NextResponse.json(hit.data);
    }

    const data = await getTrafficDashboard({
      days: Number.isFinite(days) ? days : 30,
      bin,
      filters,
    });

    cache.set(cacheKey, { data, ts: Date.now() });
    return NextResponse.json(data);
  } catch (error) {
    console.error('Traffic dashboard API error:', error);
    return NextResponse.json({ error: 'Failed to fetch traffic data' }, { status: 500 });
  }
});
