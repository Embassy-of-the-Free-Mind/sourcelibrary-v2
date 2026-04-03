import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth-helpers';
import { supabase } from '@/lib/supabase';

// In-memory cache (10 minutes — traffic data changes slowly)
let cache: { data: unknown; ts: number } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000;

/** Fetch all pageviews from Supabase, paginating through 1000-row pages. */
async function fetchAllPageviews(since: string) {
  const rows: any[] = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from('analytics_pageviews')
      .select('path, referrer, country, ip, timestamp')
      .gte('timestamp', since)
      .not('path', 'is', null)
      .order('timestamp', { ascending: false })
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    rows.push(...data);
    offset += 1000;
    if (data.length < 1000) break;
  }
  return rows;
}

export const GET = withAuth(async (request, session) => {
  try {
    if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
      return NextResponse.json(cache.data);
    }

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const rows = await fetchAllPageviews(since);

    // Aggregate in JS (Supabase REST doesn't support GROUP BY)
    const uniqueIps = new Set<string>();
    const pageCountMap = new Map<string, number>();
    const referrerCountMap = new Map<string, number>();
    const countryCountMap = new Map<string, number>();
    const hourlyMap = new Map<string, { ips: Set<string>; pageviews: number }>();

    for (const row of rows) {
      if (row.ip) uniqueIps.add(row.ip);

      // Top pages
      if (row.path) {
        pageCountMap.set(row.path, (pageCountMap.get(row.path) || 0) + 1);
      }

      // Top referrers
      if (row.referrer) {
        referrerCountMap.set(row.referrer, (referrerCountMap.get(row.referrer) || 0) + 1);
      }

      // Top countries
      if (row.country && row.country !== 'Unknown') {
        countryCountMap.set(row.country, (countryCountMap.get(row.country) || 0) + 1);
      }

      // Visitors by hour
      if (row.timestamp) {
        const hour = row.timestamp.substring(0, 13) + ':00';
        const hourEntry = hourlyMap.get(hour) || { ips: new Set(), pageviews: 0 };
        if (row.ip) hourEntry.ips.add(row.ip);
        hourEntry.pageviews++;
        hourlyMap.set(hour, hourEntry);
      }
    }

    const sortDesc = (map: Map<string, number>) =>
      [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

    const data = {
      totalPageviews: rows.length,
      totalVisitors: uniqueIps.size,
      topPages: sortDesc(pageCountMap).map(([path, count]) => ({ path, count })),
      topReferrers: sortDesc(referrerCountMap).map(([referrer, count]) => ({ referrer, count })),
      topCountries: sortDesc(countryCountMap).map(([country, count]) => ({ country, count })),
      visitorsByHour: [...hourlyMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([hour, v]) => ({ hour, visitors: v.ips.size, pageviews: v.pageviews })),
    };

    cache = { data, ts: Date.now() };
    return NextResponse.json(data);
  } catch (error) {
    console.error('Analytics API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch analytics' },
      { status: 500 }
    );
  }
});
