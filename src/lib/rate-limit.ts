/**
 * Simple in-memory rate limiter for Vercel serverless.
 *
 * Each serverless instance maintains its own counter map, so limits are
 * per-instance rather than global. This is sufficient to catch abuse
 * (bots hitting one instance repeatedly) without external infrastructure.
 *
 * Counters are pruned on access to prevent memory leaks.
 */

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
