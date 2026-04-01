import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAuth } from '@/lib/auth-helpers';

// In-memory cache (10 minutes — traffic data changes slowly)
let cache: { data: unknown; ts: number } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000;

export const GET = withAuth(async (request, session) => {
  try {
    if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
      return NextResponse.json(cache.data);
    }

    const db = await getDb();
    const collection = db.collection('analytics_pageviews');
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentWithPath = { timestamp: { $gte: thirtyDaysAgo }, path: { $ne: null } };

    // Single $facet aggregation instead of 6 separate queries
    const [result] = await collection.aggregate([
      { $match: recentWithPath },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                pageviews: { $sum: 1 },
                ips: { $addToSet: '$ip' },
              },
            },
          ],
          topPages: [
            { $group: { _id: '$path', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 },
          ],
          topReferrers: [
            { $group: { _id: '$referrer', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 },
          ],
          topCountries: [
            { $match: { country: { $ne: 'Unknown' } } },
            { $group: { _id: '$country', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 },
          ],
          visitorsByHour: [
            {
              $group: {
                _id: { $dateToString: { format: '%Y-%m-%d %H:00', date: '$timestamp' } },
                visitors: { $addToSet: '$ip' },
                pageviews: { $sum: 1 },
              },
            },
            { $project: { _id: 0, hour: '$_id', visitors: { $size: '$visitors' }, pageviews: 1 } },
            { $sort: { hour: 1 } },
          ],
        },
      },
    ]).toArray();

    const totals = result.totals[0] || { pageviews: 0, ips: [] };

    const data = {
      totalPageviews: totals.pageviews,
      totalVisitors: totals.ips.length,
      topPages: result.topPages.map((p: any) => ({ path: p._id, count: p.count })),
      topReferrers: result.topReferrers.map((r: any) => ({ referrer: r._id, count: r.count })),
      topCountries: result.topCountries.map((c: any) => ({ country: c._id, count: c.count })),
      visitorsByHour: result.visitorsByHour,
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
