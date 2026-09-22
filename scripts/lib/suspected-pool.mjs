// PRIOR ART: scripts/workers/traffic-anomaly-alert.mjs — owns the DETECTION
// (the UA_FANOUT_* thresholds and the shared_fingerprint_pool check) and is the
// only writer of `suspected_pool_fingerprints`. It is a cron worker that exits
// non-zero and pushes ntfy, so the analytics scripts cannot import it to ask
// "is this UA a pool?" without inheriting a Mongo connection, an alert push and
// a process.exit. This module is the READ side of the same verdict, and nothing
// else in scripts/lib reads analytics traffic classes (checked: the only other
// files touching bot filtering are the three analytics scripts, each carrying
// its own private BOT_RE over user agents — which is exactly the duplication
// this replaces).
//
// Why a stored verdict instead of a UA pattern in src/lib/traffic-classification.ts:
// the 2026-09-20 pool wore a byte-identical stock Chrome 151 string. Real people
// use Chrome 151. Writing that string into OTHER_BOT would have moved the error
// rather than fixing it — mislabelling real readers as bots, and going stale the
// moment the pool rotates to Chrome 154. The detector re-derives the list every
// hour from shape alone, so rotation is handled by construction.

/** Collection holding one document per flagged user-agent string. */
export const POOL_COLLECTION = 'suspected_pool_fingerprints';

/**
 * Fingerprints still considered active.
 *
 * A flagged string stays excluded for `staleDays` after it was last seen, then
 * falls out on its own — so a pool that leaves stops suppressing traffic, and
 * a UA string that a pool briefly borrowed is not blacklisted forever. Returns
 * a Set of exact UA strings.
 *
 * PASS THE WINDOW YOU ARE MEASURING. A 30-day MAU must exclude any string that
 * was a pool at any point in those 30 days, not just one still running today —
 * otherwise a pool that stopped a week ago is still counted as 44,000 monthly
 * actives. Callers reporting "right now" can keep the default.
 */
export async function activePoolFingerprints(db, { staleDays = 14 } = {}) {
  const cutoff = new Date(Date.now() - staleDays * 864e5);
  const rows = await db
    .collection(POOL_COLLECTION)
    .find({ last_seen: { $gte: cutoff } })
    .project({ _id: 1 })
    .toArray()
    .catch(() => []);
  return new Set(rows.map((r) => r._id));
}

/**
 * A Mongo filter fragment excluding the active pool fingerprints.
 *
 * Spread into a `$match`. Returns `{}` when nothing is flagged, so callers do
 * not need to branch — and, importantly, so an empty collection cannot
 * accidentally filter everything out.
 *
 * `field` is the UA field name, which differs by collection:
 * `analytics_pageviews` uses `userAgent`, `analytics_events` uses `user_agent`.
 */
export function excludePoolFilter(fingerprints, field = 'userAgent') {
  if (!fingerprints || fingerprints.size === 0) return {};
  return { [field]: { $nin: [...fingerprints] } };
}

/**
 * One line for the top of a report, so a number is never quoted without the
 * caveat attached. Returns null when there is nothing to say.
 */
export function poolBanner(fingerprints, { excludedReads = null } = {}) {
  if (!fingerprints || fingerprints.size === 0) return null;
  const n = fingerprints.size;
  const vol = excludedReads === null ? '' : ` ${excludedReads.toLocaleString()} events excluded.`;
  return `NOTE: ${n} user-agent fingerprint${n === 1 ? '' : 's'} currently flagged as a residential proxy pool by traffic-anomaly-alert.${vol} Figures below EXCLUDE that traffic; a raw pageview count over this window will be much higher and is not audience.`;
}
