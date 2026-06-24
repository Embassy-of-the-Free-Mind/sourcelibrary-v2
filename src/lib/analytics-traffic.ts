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

// ── Rich dashboard query (range/bin/compare + sections + cross-filter) ───────
// Powers the standalone /traffic page. getTrafficData() above stays as the
// simple shape consumed by the /analytics Traffic tab.

export type TrafficBin = 'hour' | 'day' | 'week';

export interface TrafficFilters {
  country?: string;
  section?: string; // top-level section, e.g. '/book' or '/embed/bph'
  referrer?: string;
  host?: string; // tenant subdomain, e.g. 'bph.sourcelibrary.org'
}

export interface TrafficDashboardData {
  range: { days: number; bin: TrafficBin; since: string };
  filters: TrafficFilters;
  summary: { pageviews: number; visitors: number; prevPageviews: number; prevVisitors: number };
  series: Array<{ bucket: string; pageviews: number; visitors: number }>;
  sections: Array<{ section: string; count: number }>;
  sites: Array<{ host: string; count: number }>;
  topPages: Array<{ path: string; count: number }>;
  topReferrers: Array<{ referrer: string; count: number }>;
  topCountries: Array<{ country: string; count: number }>;
  // Human vs bot vs AI, from the compact ingestion counter (not the pageview
  // collection). Empty until traffic accrues after this feature ships.
  classification: Array<{ class: string; count: number }>;
}

const MAX_DAYS = 90; // analytics_pageviews has a 90-day TTL — nothing older exists

function defaultBin(days: number): TrafficBin {
  if (days <= 2) return 'hour';
  if (days <= 60) return 'day';
  return 'week';
}

// Derive a top-level "section" from the path. `/embed/<tenant>` keeps two
// segments so partner reading-room traffic is its own section; everything else
// collapses to its first segment ('/', '/book', '/gallery', …).
const SECTION_EXPR = {
  $let: {
    vars: { parts: { $split: ['$path', '/'] } },
    in: {
      $cond: [
        { $eq: [{ $arrayElemAt: ['$$parts', 1] }, 'embed'] },
        { $concat: ['/embed/', { $ifNull: [{ $arrayElemAt: ['$$parts', 2] }, ''] }] },
        { $concat: ['/', { $ifNull: [{ $arrayElemAt: ['$$parts', 1] }, ''] }] },
      ],
    },
  },
};

export async function getTrafficDashboard(opts: {
  days?: number;
  bin?: TrafficBin;
  filters?: TrafficFilters;
} = {}): Promise<TrafficDashboardData> {
  const db = await getReadDb();
  const days = Math.min(Math.max(1, opts.days ?? 30), MAX_DAYS);
  const bin = opts.bin ?? defaultBin(days);
  const filters = opts.filters ?? {};

  const rangeMs = days * 24 * 60 * 60 * 1000;
  const since = new Date(Date.now() - rangeMs);
  const prevSince = new Date(since.getTime() - rangeMs);

  const col = db.collection('analytics_pageviews');

  // Base match shared by current + prior windows (country/referrer filter, but
  // NOT section — section is applied per-sub-pipeline so the sections list can
  // still offer every section to switch to).
  const baseMatch: Record<string, unknown> = { path: { $ne: null } };
  if (filters.country) baseMatch.country = filters.country;
  if (filters.referrer) baseMatch.referrer = filters.referrer;
  if (filters.host) baseMatch.host = filters.host;

  const sectionMatch = filters.section ? [{ $match: { _section: filters.section } }] : [];

  const [result] = await col
    .aggregate(
      [
        { $match: { ...baseMatch, timestamp: { $gte: since } } },
        { $addFields: { _section: SECTION_EXPR } },
        {
          $facet: {
            totals: [
              ...sectionMatch,
              { $group: { _id: null, pageviews: { $sum: 1 }, ips: { $addToSet: '$ip' } } },
            ],
            series: [
              ...sectionMatch,
              {
                $group: {
                  _id: { $dateTrunc: { date: '$timestamp', unit: bin } },
                  ips: { $addToSet: '$ip' },
                  pageviews: { $sum: 1 },
                },
              },
              { $sort: { _id: 1 } },
            ],
            sections: [
              { $group: { _id: '$_section', count: { $sum: 1 } } },
              { $sort: { count: -1 } },
              { $limit: 25 },
            ],
            sites: [
              ...sectionMatch,
              { $group: { _id: { $ifNull: ['$host', '(pre-tracking)'] }, count: { $sum: 1 } } },
              { $sort: { count: -1 } },
              { $limit: 10 },
            ],
            topPages: [
              ...sectionMatch,
              { $group: { _id: '$path', count: { $sum: 1 } } },
              { $sort: { count: -1 } },
              { $limit: 15 },
            ],
            topReferrers: [
              ...sectionMatch,
              { $match: { referrer: { $nin: [null, '', 'direct'] } } },
              { $group: { _id: '$referrer', count: { $sum: 1 } } },
              { $sort: { count: -1 } },
              { $limit: 10 },
            ],
            topCountries: [
              ...sectionMatch,
              { $match: { country: { $nin: [null, '', 'Unknown'] } } },
              { $group: { _id: '$country', count: { $sum: 1 } } },
              { $sort: { count: -1 } },
              { $limit: 10 },
            ],
          },
        },
      ],
      { allowDiskUse: true }
    )
    .toArray();

  // Prior-period totals (same filters incl. section) for compare deltas.
  const [prev] = await col
    .aggregate(
      [
        { $match: { ...baseMatch, timestamp: { $gte: prevSince, $lt: since } } },
        ...(filters.section
          ? [{ $addFields: { _section: SECTION_EXPR } }, { $match: { _section: filters.section } }]
          : []),
        { $group: { _id: null, pageviews: { $sum: 1 }, ips: { $addToSet: '$ip' } } },
      ],
      { allowDiskUse: true }
    )
    .toArray();

  // Human/bot/AI split from the compact per-day counter (separate collection,
  // no TTL). Section/country/referrer filters don't apply here (the counter
  // isn't per-pageview), but host does.
  const sinceDay = since.toISOString().slice(0, 10);
  const classMatch: Record<string, unknown> = { day: { $gte: sinceDay } };
  if (filters.host) classMatch.host = filters.host;
  const classRows = await db
    .collection('analytics_traffic_class')
    .aggregate([
      { $match: classMatch },
      { $group: { _id: '$class', count: { $sum: '$count' } } },
      { $sort: { count: -1 } },
    ])
    .toArray();

  const totals = result?.totals?.[0] as { pageviews: number; ips: (string | null)[] } | undefined;
  const prevTotals = prev as { pageviews: number; ips: (string | null)[] } | undefined;

  return {
    range: { days, bin, since: since.toISOString() },
    filters,
    summary: {
      pageviews: totals?.pageviews ?? 0,
      visitors: (totals?.ips ?? []).filter(Boolean).length,
      prevPageviews: prevTotals?.pageviews ?? 0,
      prevVisitors: (prevTotals?.ips ?? []).filter(Boolean).length,
    },
    series: (result?.series ?? []).map((s: { _id: Date; ips: (string | null)[]; pageviews: number }) => ({
      bucket: new Date(s._id).toISOString(),
      pageviews: s.pageviews,
      visitors: s.ips.filter(Boolean).length,
    })),
    sections: (result?.sections ?? [])
      .filter((s: { _id: string }) => s._id)
      .map((s: { _id: string; count: number }) => ({ section: s._id, count: s.count })),
    sites: (result?.sites ?? []).map((s: { _id: string; count: number }) => ({ host: s._id, count: s.count })),
    topPages: (result?.topPages ?? []).map((p: { _id: string; count: number }) => ({ path: p._id, count: p.count })),
    topReferrers: (result?.topReferrers ?? []).map((r: { _id: string; count: number }) => ({ referrer: r._id, count: r.count })),
    topCountries: (result?.topCountries ?? []).map((c: { _id: string; count: number }) => ({ country: c._id, count: c.count })),
    classification: (classRows as { _id: string; count: number }[]).map((c) => ({ class: c._id, count: c.count })),
  };
}
