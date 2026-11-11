// PRIOR ART: src/lib/analytics-traffic.ts (poolFingerprints) and
// scripts/lib/suspected-pool.mjs — both read `suspected_pool_fingerprints`,
// but for ANALYTICS (a Mongo $nin filter over a measured window). Neither
// answers "is THIS request a pool?" on the hot path, which needs a cached
// in-memory set rather than a query per request.

/**
 * Request-time read side of the proxy-pool verdict (#6950).
 *
 * traffic-anomaly-alert.mjs flags a user-agent string as a residential proxy
 * pool when one byte-identical string arrives from thousands of addresses a
 * day. Text served to those strings carries a per-pool extraction ref
 * (`poolRef`), so a harvested passage that surfaces elsewhere can be traced
 * to the pool that took it, not just to Source Library.
 *
 * Fails OPEN to "not a pool": a Mongo hiccup costs us a ref on a few
 * responses, never a reader's page.
 */

import { getDb } from './mongodb';
import { poolRef } from './bot-attribution';

const POOL_COLLECTION = 'suspected_pool_fingerprints';
// Same default window as scripts/lib/suspected-pool.mjs activePoolFingerprints:
// a string a pool borrowed and dropped stops being treated as one after this.
const STALE_DAYS = 14;
const TTL_MS = 10 * 60 * 1000;

let cache: { set: Set<string>; at: number } | null = null;
let inflight: Promise<Set<string>> | null = null;

async function loadPoolFingerprints(): Promise<Set<string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.set;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const db = await getDb();
      const rows = await db
        .collection<{ _id: string }>(POOL_COLLECTION)
        .find({ last_seen: { $gte: new Date(Date.now() - STALE_DAYS * 864e5) } })
        .project<{ _id: string }>({ _id: 1 })
        .toArray();
      cache = { set: new Set(rows.map((r) => r._id)), at: Date.now() };
    } catch {
      // Keep the last good set if we have one; otherwise an empty one, retried
      // after the TTL.
      cache = { set: cache?.set ?? new Set(), at: Date.now() };
    } finally {
      inflight = null;
    }
    return cache!.set;
  })();
  return inflight;
}

/**
 * The extraction ref for this request if its user agent is a flagged pool,
 * else undefined. A response that carries the ref must be served
 * `private, no-store`: the ref is per-pool, and a shared cache would hand it
 * to everyone.
 */
export async function poolRefFor(request: Request, now = new Date()): Promise<string | undefined> {
  const ua = request.headers.get('user-agent');
  if (!ua) return undefined;
  const pools = await loadPoolFingerprints();
  return pools.has(ua) ? poolRef(ua, now) : undefined;
}

/** Test seam: reset the in-memory set. */
export function _resetPoolCacheForTests(set?: Set<string>): void {
  cache = set ? { set, at: Date.now() } : null;
  inflight = null;
}
