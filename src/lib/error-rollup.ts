/**
 * Recurring-error rollup over `application_errors` (#4057).
 *
 * PRIOR ART: src/app/admin/errors/page.tsx groups the newest 100 rows by raw message in
 * the browser — one loud message fills all 100 and hides the rest, and nothing scheduled
 * reads it. scripts/audit/feedback-symptom-clusters.mjs does the same job for the
 * `feedback` collection (same idea, different store, a fixed symptom taxonomy).
 *
 * Why this exists: 194 reports of one search crash (`e.normalize is not a function`) sat
 * in the collection from 2026-07-02 until a reader emailed a screenshot on 2026-08-18.
 * The reporter worked; nobody was reading. This groups a window of rows by a NORMALISED
 * message so "the same crash, N times, on M visitors" is one line a weekly digest can
 * carry.
 *
 * The denylist lives HERE, on the read side, not in the POST handler: a denylisted
 * message is still stored, still counted in `suppressed`, and can be un-denied without
 * having lost the rows.
 */
import { ObjectId, type Db } from 'mongodb';

/** Messages that come from the visitor's browser, not from our code. */
const NOISE: Array<[string, RegExp]> = [
  ['extension-srcdoc', /Cannot assign to read only property 'srcdoc'/i],
  ['extension-rpc', /Object Not Found Matching Id:\d+, MethodName:/i],
  ['extension-rpc', /Invalid call to runtime\.sendMessage|can't access dead object/i],
  ['extension-translate', /reading 'M_ID'/i],
  ['wallet-extension', /window\.ethereum/i],
  ['in-app-browser', /__firefox__|Java object is gone|webkit\.messageHandlers|reading 'miniProgram'/i],
  ['extension-stack-patch', /Cannot (?:redefine property: stack|assign to read only property 'stack')/i],
  ['browser-ai-api', /document\.modelContext|Access to the feature "[^"]+" is disallowed by permissions policy/i],
];

/** Rows reported from a developer's machine are not reader errors. */
const DEV_URL = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i;

export function noiseClass(message: string): string | null {
  return NOISE.find(([, re]) => re.test(message))?.[0] ?? null;
}

/**
 * Fold a raw message to the pattern it is an instance of, so occurrences that differ
 * only in an id, a URL, a digest or a quoted value land in one group.
 */
export function normalizeErrorMessage(raw: string): string {
  return String(raw ?? '')
    .replace(/\s*\[digest:\d+\]/g, '')
    .replace(/^(?:Uncaught\s+)?(?:\(in promise\)\s+)?/i, '')
    .replace(/^Error:\s+/i, '')
    .replace(/https?:\/\/[^\s"')]+/g, '<url>')
    .replace(/\/_next\/static\/[^\s"')]+/g, '<chunk>')
    .replace(/"[^"]{12,}"/g, '"<…>"')
    .replace(/\b[0-9a-f]{24}\b/gi, '<id>')
    .replace(/\b\d{5,}\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

export interface ErrorGroup {
  pattern: string;
  count: number;
  /** Rows of the same pattern in the window before this one; 0 means it is new. */
  prior_count: number;
  /** Distinct reporting IPs. 0 for server-side sources that record none. */
  visitors: number;
  sources: string[];
  first_seen: string;
  last_seen: string;
  example_message: string;
  example_url: string | null;
}

export interface ErrorRollup {
  generated_at: string;
  window_days: number;
  min_count: number;
  total_rows: number;
  /** Rows outside the reported groups: below threshold, denylisted, or from localhost. */
  below_threshold_rows: number;
  suppressed: Array<{ class: string; count: number }>;
  /** True when the window held more distinct raw messages than the scan cap. */
  truncated: boolean;
  groups: ErrorGroup[];
}

interface RawGroup {
  _id: { m: string | null; s: string | null };
  n: number;
  ips: Array<string | null>;
  url: string | null;
  first: Date;
  last: Date;
}

const RAW_GROUP_CAP = 5000;

export function rollupRawGroups(
  raw: RawGroup[],
  opts: { windowDays: number; minCount: number; limit: number; truncated?: boolean; prior?: RawGroup[] },
): ErrorRollup {
  const priorCounts = new Map<string, number>();
  for (const g of opts.prior ?? []) {
    const pattern = normalizeErrorMessage(g._id.m ?? '(no message)') || '(empty message)';
    priorCounts.set(pattern, (priorCounts.get(pattern) ?? 0) + g.n);
  }

  const merged = new Map<string, {
    count: number; ips: Set<string>; sources: Set<string>; first: Date; last: Date;
    top: number; example: string; url: string | null;
  }>();
  const suppressed = new Map<string, number>();
  let total = 0;

  for (const g of raw) {
    total += g.n;
    const message = g._id.m ?? '(no message)';
    const cls = g.url && DEV_URL.test(g.url) ? 'localhost' : noiseClass(message);
    if (cls) { suppressed.set(cls, (suppressed.get(cls) ?? 0) + g.n); continue; }

    const pattern = normalizeErrorMessage(message) || '(empty message)';
    let m = merged.get(pattern);
    if (!m) {
      m = { count: 0, ips: new Set(), sources: new Set(), first: g.first, last: g.last, top: 0, example: message, url: g.url };
      merged.set(pattern, m);
    }
    m.count += g.n;
    for (const ip of g.ips) if (ip) m.ips.add(ip);
    m.sources.add(g._id.s ?? 'unknown');
    if (g.first < m.first) m.first = g.first;
    if (g.last > m.last) m.last = g.last;
    // The example is the commonest raw form, so the line reads like the real error.
    if (g.n > m.top) { m.top = g.n; m.example = message; m.url = g.url ?? m.url; }
  }

  const groups = [...merged.entries()]
    .filter(([, m]) => m.count >= opts.minCount)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, opts.limit)
    .map(([pattern, m]): ErrorGroup => ({
      pattern,
      count: m.count,
      prior_count: priorCounts.get(pattern) ?? 0,
      visitors: m.ips.size,
      sources: [...m.sources].sort(),
      first_seen: new Date(m.first).toISOString(),
      last_seen: new Date(m.last).toISOString(),
      example_message: m.example.slice(0, 300),
      example_url: m.url,
    }));

  return {
    generated_at: new Date().toISOString(),
    window_days: opts.windowDays,
    min_count: opts.minCount,
    total_rows: total,
    below_threshold_rows: total - groups.reduce((s, g) => s + g.count, 0),
    suppressed: [...suppressed.entries()].map(([cls, count]) => ({ class: cls, count })).sort((a, b) => b.count - a.count),
    truncated: Boolean(opts.truncated),
    groups,
  };
}

export async function recurringErrors(
  db: Db,
  opts: { windowDays?: number; minCount?: number; limit?: number; now?: Date } = {},
): Promise<ErrorRollup> {
  const windowDays = Math.min(Math.max(Math.trunc(opts.windowDays ?? 7) || 7, 1), 30);
  const minCount = Math.max(Math.trunc(opts.minCount ?? 10) || 10, 1);
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 25) || 25, 1), 100);
  const until = opts.now ?? new Date();
  const since = new Date(until.getTime() - windowDays * 86400_000);

  // The collection has no index on `timestamp` (415K rows, only `_id`). Every writer
  // inserts at the moment it stamps `timestamp`, so the ObjectId's own clock bounds the
  // scan to the window on the `_id` index; `timestamp` then states the window exactly.
  const fetchWindow = (from: Date, to: Date) => db.collection('application_errors').aggregate<RawGroup>([
    {
      $match: {
        _id: {
          $gte: ObjectId.createFromTime(Math.floor(from.getTime() / 1000) - 3600),
          $lte: ObjectId.createFromTime(Math.floor(to.getTime() / 1000) + 3600),
        },
        timestamp: { $gte: from, $lt: to },
      },
    },
    {
      $group: {
        // uptime_monitor rows carry `error`, not `message`.
        _id: { m: { $substrCP: [{ $ifNull: ['$message', { $ifNull: ['$error', '(no message)'] }] }, 0, 300] }, s: '$source' },
        n: { $sum: 1 },
        ips: { $addToSet: '$ip' },
        url: { $first: '$url' },
        first: { $min: '$timestamp' },
        last: { $max: '$timestamp' },
      },
    },
    { $sort: { n: -1 } },
    { $limit: RAW_GROUP_CAP + 1 },
  ], { maxTimeMS: 8000, allowDiskUse: true }).toArray();

  const [raw, prior] = await Promise.all([
    fetchWindow(since, until),
    fetchWindow(new Date(since.getTime() - windowDays * 86400_000), since),
  ]);

  return rollupRawGroups(raw.slice(0, RAW_GROUP_CAP), {
    windowDays, minCount, limit, truncated: raw.length > RAW_GROUP_CAP, prior: prior.slice(0, RAW_GROUP_CAP),
  });
}
