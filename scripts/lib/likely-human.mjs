// PRIOR ART: scripts/analytics/snapshot-metrics.mjs — the rule was written there
// for the readers map (v2#8522) as a private `geoByCountry` aggregation, grouped
// by country and nothing else. The dashboard headline, the daily series and the
// history row need the same rule grouped by DAY, so the rule moves here and both
// groupings import it; two copies of one definition would drift.
// scripts/lib/suspected-pool.mjs is the neighbour, not a fit: it excludes a
// fleet by a stored user-agent verdict, and this counts readers by behaviour.
//
// LIKELY HUMAN (method `likely-human-v1`)
//
// `analytics_pageviews` is written by a JavaScript beacon, so everything in it
// ran JavaScript. Residential-proxy fleets do too, and wear stock browser user
// agents, so neither the bot pattern nor the pool list sees most of them
// (.claude/docs/invariants/measurement-instruments.md, 2026-08-09). What gives a
// fleet away is behaviour: desktop, no referrer, one or two pages. A fingerprint
// (IP + browser) counts as likely human when it breaks that pattern at least
// once in the period: it came from another site, read 3+ pages, or used a phone.
//
// Tested 2026-11-12 over 30 days (#48):
//   - Known humans: 1,538 fingerprints that loaded a signed-in-only page. The
//     rule keeps 2,370 of their 2,622 fingerprint-days (90.4%). The misses are
//     desktop, direct, 1-2 pages. Signed-in readers are more engaged than
//     anonymous ones, so recall on anonymous readers is below 90%.
//   - Known fleet: on 2026-11-06 about 44,000 excess fingerprints added about
//     1,300 likely-human ones, so the rule passed roughly 3% of that fleet.
//   - "3+ pages" is the weak signal (a crawler that reads several pages passes).
//     `strict` drops it: referred or phone only. Read the two as a range.
//
// A fingerprint is not a person: one reader on a phone and a laptop is two, and
// a household on one browser can be one.

export const LIKELY_HUMAN_METHOD = 'likely-human-v1';

/** `referrer` is stored as a bare domain ('direct', 'google.com', ...). */
export const EXTERNAL_REF = '^(?!direct$|localhost|127\\.|([a-z0-9-]+\\.)*sourcelibrary\\.org$).+';
export const PHONE_UA = 'Mobile|Android|iPhone|iPad';
export const DEEP_PAGES = 3;

/**
 * User agents of our own tools: the search probe, the eval harness and bare
 * Node scripts. They are not bots by the crawler pattern and not readers.
 * (`sl-search-probe/1` wrote 49,671 of 176,378 "human" searches in 30 days, #48.)
 */
export const OWN_TOOL_UA = /^(sl-[a-z0-9-]+\/|node$|undici$)/i;

/** `$group` accumulators for one fingerprint: page views and the two flags. */
export const fingerprintSignals = {
  pv: { $sum: 1 },
  referred: { $max: { $cond: [{ $regexMatch: { input: { $ifNull: ['$referrer', 'direct'] }, regex: EXTERNAL_REF } }, 1, 0] } },
  phone: { $max: { $cond: [{ $regexMatch: { input: { $ifNull: ['$userAgent', ''] }, regex: PHONE_UA } }, 1, 0] } },
};

/** Expressions over a grouped fingerprint (the fields of `fingerprintSignals`). */
export const isStrict = { $or: [{ $eq: ['$referred', 1] }, { $eq: ['$phone', 1] }] };
export const isLikely = { $or: [{ $eq: ['$referred', 1] }, { $gte: ['$pv', DEEP_PAGES] }, { $eq: ['$phone', 1] }] };

const fingerprint = { ip: '$ip', ua: { $substr: ['$userAgent', 0, 60] } };
const count = (expr) => ({ $sum: { $cond: [expr, 1, 0] } });
const tally = {
  all: { $sum: 1 },
  likely: count(isLikely),
  strict: count(isStrict),
  pageviews: { $sum: '$pv' },
  likelyPageviews: { $sum: { $cond: [isLikely, '$pv', 0] } },
};

/**
 * Fingerprints per UTC day: all, likely human, and strict (referred or phone).
 * `match` carries the caller's bot and pool exclusions. Oldest day first.
 *
 * Pass UTC midnights for `from` and `to`, or the edge days are partial. Thirty
 * days takes about 20 s on the 2.5M-row collection and ninety times out, so a
 * long range is asked for in chunks (`likelyHumanDailyChunked`).
 */
export async function likelyHumanDaily(pageviews, { from, to = new Date(), match = {} }) {
  const rows = await pageviews.aggregate([
    { $match: { timestamp: { $gte: from, $lt: to }, ...match } },
    { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }, ...fingerprint }, ...fingerprintSignals } },
    { $group: { _id: '$_id.day', ...tally } },
    { $sort: { _id: 1 } },
  ], { allowDiskUse: true }).toArray();
  return rows.map(({ _id, ...r }) => ({ date: _id, ...r }));
}

/** The last `days` full UTC days (today excluded), read in chunks that each finish in seconds. */
export async function likelyHumanDailyChunked(pageviews, { days, match = {}, chunkDays = 30, now = Date.now() }) {
  const DAY = 864e5;
  const end = Math.floor(now / DAY) * DAY; // today 00:00 UTC
  const out = [];
  for (let start = end - days * DAY; start < end; start += chunkDays * DAY) {
    out.push(...await likelyHumanDaily(pageviews, { from: new Date(start), to: new Date(Math.min(start + chunkDays * DAY, end)), match }));
  }
  return out;
}

/**
 * Merge freshly computed days over a stored series: a fresh day replaces the
 * stored one, and days older than `keepDays` fall off. Oldest first.
 */
export function mergeDaily(stored, fresh, { keepDays, now = Date.now() }) {
  const cutoff = new Date(now - keepDays * 864e5).toISOString().slice(0, 10);
  const byDate = new Map();
  for (const d of [...(stored || []), ...fresh]) if (d?.date >= cutoff) byDate.set(d.date, d);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Distinct fingerprints over the whole window (a 30-day window is the monthly figure). */
export async function likelyHumanTotal(pageviews, { from, match = {} }) {
  const [r] = await pageviews.aggregate([
    { $match: { timestamp: { $gt: from }, ...match } },
    { $group: { _id: fingerprint, ...fingerprintSignals } },
    { $group: { _id: null, ...tally } },
  ], { allowDiskUse: true }).toArray();
  const { _id, ...totals } = r || { all: 0, likely: 0, strict: 0, pageviews: 0, likelyPageviews: 0 };
  return totals;
}

/** Median, rounded. A mean of daily fingerprints carries any one fleet day; a median does not. */
export function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return 0;
  const mid = Math.floor(v.length / 2);
  return Math.round(v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2);
}
