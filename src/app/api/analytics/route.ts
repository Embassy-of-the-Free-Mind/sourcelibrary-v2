import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { withAuth } from '@/lib/auth-helpers';

export const maxDuration = 30;

// In-memory cache (10 minutes — traffic data changes slowly)
let cache: { data: unknown; ts: number } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000;

/** Fetch all pageviews from Supabase within a date range, paginating through 1000-row pages. */
async function fetchAllPageviews(since: string) {
  const rows: any[] = [];
  const PAGE_SIZE = 1000;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('analytics_pageviews')
      .select('path, referrer, country, ip, timestamp')
      .gte('timestamp', since)
      .not('path', 'is', null)
      .order('timestamp', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(`Supabase query failed: ${error.message}`);
    if (!data || data.length === 0) break;

    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return rows;
}

export const GET = withAuth(async (request, session) => {
  try {
    if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
      return NextResponse.json(cache.data);
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const rows = await fetchAllPageviews(thirtyDaysAgo);

    // Aggregate in JS (replaces MongoDB $facet)
    const allIps = new Set<string>();
    const pathCounts = new Map<string, number>();
    const referrerCounts = new Map<string, number>();
    const countryCounts = new Map<string, number>();
    const hourlyMap = new Map<string, { ips: Set<string>; pageviews: number }>();

    for (const row of rows) {
      // Totals — unique IPs
      if (row.ip) allIps.add(row.ip);

      // Top pages
      if (row.path) {
        pathCounts.set(row.path, (pathCounts.get(row.path) || 0) + 1);
      }

      // Top referrers
      const ref = row.referrer ?? null;
      referrerCounts.set(ref, (referrerCounts.get(ref) || 0) + 1);

      // Top countries (exclude 'Unknown')
      if (row.country && row.country !== 'Unknown') {
        countryCounts.set(row.country, (countryCounts.get(row.country) || 0) + 1);
      }

      // Visitors by hour — truncate timestamp to hour
      if (row.timestamp) {
        const hourKey = row.timestamp.slice(0, 13) + ':00'; // "2026-03-31T14:00"
        let entry = hourlyMap.get(hourKey);
        if (!entry) {
          entry = { ips: new Set(), pageviews: 0 };
          hourlyMap.set(hourKey, entry);
        }
        entry.pageviews++;
        if (row.ip) entry.ips.add(row.ip);
      }
    }

    // Build top-N lists
    const topPages = [...pathCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([path, count]) => ({ path, count }));

    const topReferrers = [...referrerCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([referrer, count]) => ({ referrer, count }));

    const topCountries = [...countryCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([country, count]) => ({ country, count }));

    const visitorsByHour = [...hourlyMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([hour, v]) => ({ hour, visitors: v.ips.size, pageviews: v.pageviews }));

    const data = {
      totalPageviews: rows.length,
      totalVisitors: allIps.size,
      topPages,
      topReferrers,
      topCountries,
      visitorsByHour,
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
