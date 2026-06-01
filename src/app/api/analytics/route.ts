import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-helpers';
import { getTrafficData } from '@/lib/analytics-traffic';

export const maxDuration = 30;

// In-memory cache (10 minutes — traffic data changes slowly)
let cache: { data: unknown; ts: number } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000;

// Reads first-party pageviews directly from MongoDB (the source of truth).
// See src/lib/analytics-traffic.ts for why we no longer go through Supabase.
export const GET = withAuth(async () => {
  try {
    if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
      return NextResponse.json(cache.data);
    }

    const data = await getTrafficData(30);
    cache = { data, ts: Date.now() };
    return NextResponse.json(data);
  } catch (error) {
    console.error('Analytics API error:', error);
    return NextResponse.json({ error: 'Failed to fetch analytics' }, { status: 500 });
  }
});
