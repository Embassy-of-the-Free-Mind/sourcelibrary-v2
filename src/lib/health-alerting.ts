import type { Db } from 'mongodb';

/**
 * Shared plumbing for the health probes that page Derek.
 *
 * Motivating incident (2026-07-31): a single dropped Atlas TLS handshake at
 * 00:00:01 UTC made /api/health/auth report `database: error` and send a
 * "[CRITICAL] Source Library sign-in is broken" email. Sign-in was never
 * broken — a new user account was created two minutes later, and 2,013 of the
 * preceding 2,016 probes were clean. Both DB-touching probes failed in the same
 * second because nine Hetzner cron schedules converge at 00:00 UTC, so a pile of
 * cold Vercel functions all opened fresh TLS connections to Atlas at once.
 *
 * Per CLAUDE.md ("a metric is a claim about an instrument before it is a claim
 * about readers"), the defect is the alerting policy, not the connection. Two
 * guards live here:
 *
 *   1. `retryWithBackoff` — absorb a blip WITHIN one probe. The old code retried
 *      back-to-back with no delay, so a fault lasting a couple of seconds
 *      defeated both attempts.
 *   2. `recordFailureStreaks` — require N consecutive failed probes before
 *      paging, tracked per failing check so unrelated one-off blips in
 *      different providers never add up to a page.
 */

/** Default gap between attempts. Grows so a multi-second fault is still caught. */
const DEFAULT_BACKOFF_MS = [300, 900];

export interface RetryOptions {
  /** Delay before each retry. Attempt count is `backoffMs.length + 1`. */
  backoffMs?: number[];
  /** Called before each retry — used to force a fresh connection. */
  onRetry?: (attempt: number) => void | Promise<void>;
  /** Injectable for tests so they don't sleep for real. */
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Run `fn`, retrying on throw with a growing delay between attempts.
 * Rethrows the LAST error if every attempt fails.
 */
export async function retryWithBackoff<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const backoff = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const sleep = options.sleep ?? realSleep;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= backoff.length; attempt++) {
    if (attempt > 0) {
      await sleep(backoff[attempt - 1]);
      await options.onRetry?.(attempt);
    }
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

export interface StreakDecision {
  /** Checks whose consecutive-failure count has reached the threshold. */
  confirmed: string[];
  /** Consecutive-failure count per check, after this probe. */
  streaks: Record<string, number>;
  /**
   * True when the streak could not be persisted. The store lives in Mongo, so
   * this generally means Atlas is genuinely unreachable — exactly when a page
   * IS warranted. Callers must treat it as "alert now" (fail open).
   */
  storeUnavailable: boolean;
}

/**
 * Increment the consecutive-failure count for each failing check, reset every
 * other known check to zero, and report which ones have reached `threshold`.
 *
 * Streaks are per-check on purpose. A database blip on one probe followed by an
 * unrelated email blip on the next is two isolated faults, not a two-probe
 * outage, and must not page.
 */
export async function recordFailureStreaks(
  db: Db | null,
  stateKey: string,
  failingChecks: string[],
  threshold: number
): Promise<StreakDecision> {
  const unavailable = (): StreakDecision => ({
    confirmed: [...failingChecks],
    streaks: Object.fromEntries(failingChecks.map(c => [c, 1])),
    storeUnavailable: true,
  });

  if (!db) return unavailable();

  try {
    const doc = await db.collection('system_config').findOne(
      { _id: stateKey as any },
      { maxTimeMS: 5000 }
    );
    const previous: Record<string, number> = doc?.streaks ?? {};

    // Reset everything we've seen before, then increment the current failures.
    const streaks: Record<string, number> = {};
    for (const check of Object.keys(previous)) streaks[check] = 0;
    for (const check of failingChecks) streaks[check] = (previous[check] ?? 0) + 1;

    await db.collection('system_config').updateOne(
      { _id: stateKey as any },
      { $set: { streaks, last_failure_at: new Date(), last_failing_checks: failingChecks } },
      { upsert: true }
    );

    return {
      confirmed: failingChecks.filter(c => streaks[c] >= threshold),
      streaks,
      storeUnavailable: false,
    };
  } catch {
    // Can't reach the store to prove this is a repeat — assume the worst.
    return unavailable();
  }
}

/** Zero every streak after a clean probe. No-ops until the state doc exists. */
export async function clearFailureStreaks(db: Db | null, stateKey: string): Promise<void> {
  if (!db) return;
  try {
    await db.collection('system_config').updateOne(
      { _id: stateKey as any, streaks: { $exists: true } },
      { $set: { streaks: {}, last_clear_at: new Date() } }
    );
  } catch {
    // Non-fatal: a stale streak costs at most one delayed page.
  }
}
