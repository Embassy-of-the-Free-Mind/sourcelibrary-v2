import type { Db } from 'mongodb';
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

// ── Proxy-pool exclusion ─────────────────────────────────────────────────────
// `/api/track` labels every beacon human, because a beacon only fires from a
// browser that ran JavaScript (#3657). Residential proxy pools run JavaScript
// too: on 2026-09-19 one forged Chrome string was 87% of the day's pageviews.
// scripts/workers/traffic-anomaly-alert.mjs flags such strings hourly into
// `suspected_pool_fingerprints`; this is the TypeScript read side of
// scripts/lib/suspected-pool.mjs, so the dashboard and the metrics snapshot
// exclude the same traffic.
//
// Exclude every string flagged at any point in the window being measured, for
// the whole window. The detector's first_seen lags the pool's arrival (on
// 2026-09-19 its flagged hours covered 7K of the pool's 68K views), so a
// per-hour exclusion would leave most of a pool in.

const POOL_COLLECTION = 'suspected_pool_fingerprints';

async function poolFingerprints(db: Db, since: Date): Promise<string[]> {
  const rows = await db
    .collection<{ _id: string }>(POOL_COLLECTION)
    .find({ last_seen: { $gte: since } })
    .project<{ _id: string }>({ _id: 1 })
    .toArray()
    .catch(() => []);
  return rows.map((r) => r._id);
}

function excludePool(fingerprints: string[]): Record<string, unknown> {
  return fingerprints.length ? { userAgent: { $nin: fingerprints } } : {};
}

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
  const pool = await poolFingerprints(db, since);

  const [result] = await db
    .collection('analytics_pageviews')
    .aggregate(
      [
        { $match: { timestamp: { $gte: since }, path: { $ne: null }, ...excludePool(pool) } },
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
// Powers /admin/traffic. getTrafficData() above stays as the simple shape the
// tenant analytics route reads.

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
  // Clicks (= distinct visitors) per source, not pageviews. `referrer` is
  // frozen at the visit's entry point and re-sent on every in-app navigation,
  // so topReferrers above counts every page a visitor reads under their
  // arrival source. Deduping by anonymized IP collapses that back to one
  // "click" per visitor, which is the number comparable to Search Console.
  clicksBySource: Array<{ referrer: string; count: number }>;
  topCountries: Array<{ country: string; count: number }>;
  // What the figures above leave out. `pool` is pageviews from flagged proxy
  // pool strings, removed from every number on the page. `bots` are requests
  // the server-side classifier recognised (crawlers, AI agents), which never
  // reach the beacon and so were never in the pageview figures to begin with.
  excluded: {
    pool: { pageviews: number; fingerprints: number };
    bots: Array<{ class: string; count: number }>;
  };
  // First day with any pageview row, so the page can say how far back it goes.
  earliest: string | null;
}

// analytics_pageviews has no TTL (rows reach back to 2026-04-05). The cap only
// bounds the scan; a year is ~2M rows.
const MAX_DAYS = 366;

function defaultBin(days: number): TrafficBin {
  if (days <= 2) return 'hour';
  if (days <= 120) return 'day';
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
  const pool = await poolFingerprints(db, prevSince);

  // Base match shared by current + prior windows (country/referrer filter, but
  // NOT section — section is applied per-sub-pipeline so the sections list can
  // still offer every section to switch to).
  const filterMatch: Record<string, unknown> = { path: { $ne: null } };
  if (filters.country) filterMatch.country = filters.country;
  if (filters.referrer) filterMatch.referrer = filters.referrer;
  if (filters.host) filterMatch.host = filters.host;
  const baseMatch = { ...filterMatch, ...excludePool(pool) };

  const sectionMatch = filters.section ? [{ $match: { _section: filters.section } }] : [];

  // The queries below are independent full scans of the window; run them in
  // parallel so the page waits for the slowest, not the sum.
  const mainQuery = col
    .aggregate(
      [
        { $match: { ...baseMatch, timestamp: { $gte: since } } },
        // Carry only the fields the facets read: $facet materialises its input,
        // and a full pageview row (user agent, headers) is several times larger.
        { $project: { _id: 0, path: 1, timestamp: 1, ip: 1, host: 1, referrer: 1, country: 1 } },
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
            clicksBySource: [
              ...sectionMatch,
              { $match: { referrer: { $nin: [null, '', 'direct'] } } },
              // Dedupe to one click per distinct visitor (anonymized IP) per source.
              { $group: { _id: '$referrer', ips: { $addToSet: '$ip' } } },
              { $project: { count: { $size: '$ips' } } },
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
  const prevQuery = col
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

  // Pageviews the pool exclusion removed in this window (same non-pool filters).
  const poolQuery = pool.length
    ? col.countDocuments({ ...filterMatch, timestamp: { $gte: since }, userAgent: { $in: pool } })
    : Promise.resolve(0);

  // Bot and AI requests from the compact per-day counter the proxy writes
  // (separate collection). Its `human` row is every beacon, pool included, so
  // it is not shown. Section/country/referrer filters don't apply here (the
  // counter isn't per-pageview), but host does.
  const sinceDay = since.toISOString().slice(0, 10);
  const classMatch: Record<string, unknown> = { day: { $gte: sinceDay }, class: { $ne: 'human' } };
  if (filters.host) classMatch.host = filters.host;
  const [[result], [prev], poolPageviews, classRows, first] = await Promise.all([
    mainQuery,
    prevQuery,
    poolQuery,
    db
      .collection('analytics_traffic_class')
      .aggregate([
        { $match: classMatch },
        { $group: { _id: '$class', count: { $sum: '$count' } } },
        { $sort: { count: -1 } },
      ])
      .toArray(),
    col.find({}, { projection: { timestamp: 1 } }).sort({ timestamp: 1 }).limit(1).next(),
  ]);

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
    clicksBySource: (result?.clicksBySource ?? []).map((r: { _id: string; count: number }) => ({ referrer: r._id, count: r.count })),
    topCountries: (result?.topCountries ?? []).map((c: { _id: string; count: number }) => ({ country: c._id, count: c.count })),
    excluded: {
      pool: { pageviews: poolPageviews, fingerprints: pool.length },
      bots: (classRows as { _id: string; count: number }[]).map((c) => ({ class: c._id, count: c.count })),
    },
    earliest: first?.timestamp ? new Date(first.timestamp).toISOString().slice(0, 10) : null,
  };
}
