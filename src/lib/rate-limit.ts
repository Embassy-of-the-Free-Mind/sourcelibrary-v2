/**
 * Simple in-memory rate limiter for Vercel serverless.
 *
 * Each serverless instance maintains its own counter map, so limits are
 * per-instance rather than global. This is sufficient to catch abuse
 * (bots hitting one instance repeatedly) without external infrastructure.
 *
 * Counters are pruned on access to prevent memory leaks.
 */

import { recordRateLimitDenial } from '@/lib/abuse-log';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const limiters = new Map<string, Map<string, RateLimitEntry>>();

interface RateLimitConfig {
  /** Unique name for this limiter (e.g., "identify", "search") */
  name: string;
  /** Max requests per window */
  limit: number;
  /** Window size in seconds */
  windowSeconds: number;
}

/**
 * Check if a request is within rate limits.
 * Returns { allowed: true } or { allowed: false, retryAfter: seconds }.
 */
export function checkRateLimit(
  config: RateLimitConfig,
  ip: string,
): { allowed: true } | { allowed: false; retryAfter: number } {
  if (!limiters.has(config.name)) {
    limiters.set(config.name, new Map());
  }
  const store = limiters.get(config.name)!;

  const now = Date.now();
  const entry = store.get(ip);

  // Prune stale entries periodically (every 100th call)
  if (store.size > 1000 && Math.random() < 0.01) {
    for (const [key, val] of store) {
      if (val.resetAt < now) store.delete(key);
    }
  }

  if (!entry || entry.resetAt < now) {
    store.set(ip, { count: 1, resetAt: now + config.windowSeconds * 1000 });
    return { allowed: true };
  }

  entry.count++;
  if (entry.count > config.limit) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    recordRateLimitDenial(config.name, ip);
    return { allowed: false, retryAfter };
  }

  return { allowed: true };
}

/**
 * Read-only sibling of checkRateLimit — returns the current usage state for an
 * IP without incrementing the counter. Used to surface "you're at N% of your
 * quota" hints in responses before the hard 401 ever fires.
 *
 * Returns { count: 0, ... } when no entry exists yet for this IP (i.e. the
 * counter was pruned or the user is on a fresh instance — usage looks low).
 */
export function peekRateLimit(
  config: RateLimitConfig,
  ip: string,
): { count: number; limit: number; remaining: number; resetAt: number } {
  const store = limiters.get(config.name);
  const now = Date.now();
  const entry = store?.get(ip);
  if (!entry || entry.resetAt < now) {
    return { count: 0, limit: config.limit, remaining: config.limit, resetAt: now + config.windowSeconds * 1000 };
  }
  return {
    count: entry.count,
    limit: config.limit,
    remaining: Math.max(0, config.limit - entry.count),
    resetAt: entry.resetAt,
  };
}

/**
 * Mongo-backed sibling of checkRateLimit — a GLOBAL counter shared across all
 * serverless instances, so the limit is a real cap rather than per-instance.
 *
 * Why: the in-memory limiter above resets on every cold start and is private to
 * each instance, so a distributed caller (or just normal fan-out across Vercel
 * lambdas) can exceed the nominal limit by a large multiple. For the expensive
 * surfaces — Gemini-backed Librarian/voice, and the Resend-backed magic-link
 * send — that soft cap is the cost-abuse vector. This makes it a hard cap.
 *
 * Uses a fixed-window atomic upsert (`$inc` on a per-(name,ip,window) doc) with
 * a TTL index so old windows self-expire. It NEVER blocks the request on a
 * limiter failure: on any error or a >1.5s round-trip it falls back to the
 * in-memory limiter, which is strictly better than locking users out when Mongo
 * is slow. Callers must `await` it.
 */
let rateLimitIndexReady: Promise<void> | null = null;
async function ensureRateLimitIndex(): Promise<void> {
  if (!rateLimitIndexReady) {
    rateLimitIndexReady = (async () => {
      const { getDb } = await import('@/lib/mongodb');
      const db = await getDb();
      // TTL index — Mongo drops each window doc shortly after it expires.
      await db.collection('rate_limits').createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 });
    })().catch((e) => {
      // Reset so a later call can retry; don't cache a rejected promise.
      rateLimitIndexReady = null;
      throw e;
    });
  }
  return rateLimitIndexReady;
}

export async function checkRateLimitShared(
  config: RateLimitConfig,
  ip: string,
): Promise<{ allowed: true } | { allowed: false; retryAfter: number }> {
  const windowMs = config.windowSeconds * 1000;
  const now = Date.now();
  const bucket = Math.floor(now / windowMs);
  const resetAtMs = (bucket + 1) * windowMs;
  const _id = `${config.name}:${ip}:${bucket}`;

  const run = async (): Promise<{ allowed: true } | { allowed: false; retryAfter: number }> => {
    await ensureRateLimitIndex();
    const { getDb } = await import('@/lib/mongodb');
    const db = await getDb();
    const doc = await db.collection('rate_limits').findOneAndUpdate(
      { _id: _id as unknown as never },
      {
        $inc: { count: 1 },
        // Keep the doc one extra window past reset so a slow clock / clustered
        // writes never resurrect a just-expired window.
        $setOnInsert: { expireAt: new Date(resetAtMs + windowMs) },
      },
      { upsert: true, returnDocument: 'after' },
    );
    const count = (doc as { count?: number } | null)?.count ?? 1;
    if (count > config.limit) {
      return { allowed: false, retryAfter: Math.ceil((resetAtMs - now) / 1000) };
    }
    return { allowed: true };
  };

  try {
    // Bound the limiter's latency: if Mongo is slow, fall back rather than
    // adding a multi-second tax to every gated request.
    const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 1500));
    const result = await Promise.race([run(), timeout]);
    // On timeout the in-memory fallback records the denial itself; on the Mongo
    // path we record here. Logging lives OUTSIDE run() so a slow request whose
    // run() resolves after the timeout can't also log — one denial, one event.
    if (result === 'timeout') return checkRateLimit(config, ip);
    if (!result.allowed) recordRateLimitDenial(config.name, ip);
    return result;
  } catch {
    // A limiter outage must never wall a user — degrade to the in-memory cap.
    return checkRateLimit(config, ip);
  }
}

/**
 * Extract client IP from request headers.
 * Vercel sets x-forwarded-for; Cloudflare sets cf-connecting-ip.
 */
export function getClientIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}
