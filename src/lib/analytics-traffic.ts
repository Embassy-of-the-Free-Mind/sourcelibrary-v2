import { getReadDb } from '@/lib/mongodb';

/**
 * First-party traffic aggregation, read directly from MongoDB.
 *
 * This is the source of truth: `/api/track` writes every (bot-filtered,
 * IP-anonymized) pageview into `analytics_pageviews` in Mongo. We previously
 * read these through a Supabase mirror, but the Hetzner `supabase-sync.mjs`
 * worker stalled on 2026-04-13 and the dashboard silently went stale. Reading
 * Mongo directly removes that moving part — the numbers are always current and
 * complete. Visitor PII (anonymized IP) never leaves the server: callers gate
 * this behind `withAuth` / `requireInnerCircle`.
 */

export interface TrafficData {
  topPages: Array<{ path: string; count: number }>;
  topReferrers: Array<{ referrer: string; count: number }>;
  topCountries: Array<{ country: string; count: number }>;
  totalVisitors: number;
  totalPageviews: number;
  visitorsByHour: Array<{ hour: string; visitors: number; pageviews: number }>;
}

export async function getTrafficData(days = 30): Promise<TrafficData> {
  const db = await getReadDb();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [result] = await db
    .collection('analytics_pageviews')
    .aggregate(
      [
        { $match: { timestamp: { $gte: since }, path: { $ne: null } } },
        {
          $facet: {
            totals: [
              { $group: { _id: null, pageviews: { $sum: 1 }, ips: { $addToSet: '$ip' } } },
            ],
            topPages: [
              { $group: { _id: '$path', count: { $sum: 1 } } },
              { $sort: { count: -1 } },
              { $limit: 10 },
            ],
            topReferrers: [
              { $match: { referrer: { $nin: [null, '', 'direct'] } } },
              { $group: { _id: '$referrer', count: { $sum: 1 } } },
              { $sort: { count: -1 } },
              { $limit: 10 },
            ],
            topCountries: [
              { $match: { country: { $nin: [null, '', 'Unknown'] } } },
              { $group: { _id: '$country', count: { $sum: 1 } } },
              { $sort: { count: -1 } },
              { $limit: 10 },
            ],
            byHour: [
              {
                $group: {
                  _id: { $dateToString: { format: '%Y-%m-%dT%H:00', date: '$timestamp' } },
                  ips: { $addToSet: '$ip' },
                  pageviews: { $sum: 1 },
                },
              },
              { $sort: { _id: 1 } },
            ],
          },
        },
      ],
      { allowDiskUse: true }
    )
    .toArray();

  const totals = result?.totals?.[0] as { pageviews: number; ips: (string | null)[] } | undefined;

  return {
    totalPageviews: totals?.pageviews ?? 0,
    totalVisitors: (totals?.ips ?? []).filter(Boolean).length,
    topPages: (result?.topPages ?? []).map((p: { _id: string; count: number }) => ({ path: p._id, count: p.count })),
    topReferrers: (result?.topReferrers ?? []).map((r: { _id: string; count: number }) => ({ referrer: r._id, count: r.count })),
    topCountries: (result?.topCountries ?? []).map((c: { _id: string; count: number }) => ({ country: c._id, count: c.count })),
    visitorsByHour: (result?.byHour ?? []).map(
      (h: { _id: string; ips: (string | null)[]; pageviews: number }) => ({
        hour: h._id,
        visitors: h.ips.filter(Boolean).length,
        pageviews: h.pageviews,
      })
    ),
  };
}
