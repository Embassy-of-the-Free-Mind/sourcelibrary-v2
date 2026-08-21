/**
 * Durable, fire-and-forget recording of rate-limit denials.
 *
 * The proxy layer already logs bot blocks to `analytics_bot_access` (via
 * POST /api/analytics/bots), and that collection is what the admin bot view
 * reads. But denials from `src/lib/rate-limit.ts` — the magic-link send, the
 * Librarian/voice caps, and the donate/subscribe email limiters added in
 * #3123 — were dropped on the floor: a 429 went out and the event evaporated.
 *
 * This writes those denials into the SAME `analytics_bot_access` collection so
 * they surface in the existing GET /api/analytics/bots aggregation with no
 * endpoint change. We store them under a synthetic bot name `ratelimit`, keyed
 * by limiter name in `path_prefix` (e.g. `limiter:donate`), with the action
 * `rate-limited` — matching the shape the proxy's own logger uses.
 *
 * Contract: never throws, never blocks the caller, bounded latency. IPs are
 * truncated (not personal data under GDPR) via anonymizeIp, consistent with
 * the rest of that collection.
 */
import { anonymizeIp } from '@/lib/anonymize-ip';

const COLLECTION = 'analytics_bot_access';
const DB_TIMEOUT_MS = 1500;

let indexEnsured = false;

async function write(limiterName: string, ip: string): Promise<void> {
  const { getDb } = await import('@/lib/mongodb');
  const db = await getDb();
  const col = db.collection(COLLECTION);

  if (!indexEnsured) {
    // Same index the POST /api/analytics/bots writer ensures — idempotent.
    col.createIndex(
      { bot: 1, path_prefix: 1, date: 1 },
      { name: 'bot_daily_idx', background: true },
    ).catch(() => {});
    indexEnsured = true;
  }

  const anonIp = anonymizeIp(ip);
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  await col.updateOne(
    { bot: 'ratelimit', path_prefix: `limiter:${limiterName}`, date },
    {
      $inc: { hits: 1 },
      $set: { last_ip: anonIp },
      $addToSet: { actions: 'rate-limited', ips: anonIp },
      $setOnInsert: { created_at: new Date() },
    },
    { upsert: true },
  );
}

/**
 * Record a single rate-limit denial. Fire-and-forget: returns immediately, the
 * write happens in the background, and any failure (including a slow Mongo) is
 * swallowed so it can never affect the request that was being limited.
 */
export function recordRateLimitDenial(limiterName: string, ip: string): void {
  void (async () => {
    try {
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, DB_TIMEOUT_MS));
      await Promise.race([write(limiterName, ip), timeout]);
    } catch {
      // never surfaces to the caller
    }
  })();
}
