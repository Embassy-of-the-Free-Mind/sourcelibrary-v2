/**
 * Simple in-memory rate limiter for Vercel serverless functions.
 *
 * Each serverless instance maintains its own counter map. This means rate limits
 * are per-instance, not global — but it's still effective at stopping abuse since
 * Vercel routes most requests from the same IP to the same instance.
 *
 * For stricter global limiting, upgrade to Vercel KV or Upstash Redis.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) {
      store.delete(key);
    }
  }
}, 5 * 60 * 1000);

export interface RateLimitConfig {
  /** Max requests per window */
  limit: number;
  /** Window duration in seconds */
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Check rate limit for a given key (typically IP address).
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig
): RateLimitResult {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    // New window
    store.set(key, {
      count: 1,
      resetAt: now + config.windowSeconds * 1000,
    });
    return { allowed: true, remaining: config.limit - 1, resetAt: now + config.windowSeconds * 1000 };
  }

  entry.count++;

  if (entry.count > config.limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  return { allowed: true, remaining: config.limit - entry.count, resetAt: entry.resetAt };
}

/**
 * Extract client IP from request headers (Vercel/Cloudflare).
 */
export function getClientIp(request: Request): string {
  return (
    (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    request.headers.get('cf-connecting-ip') ||
    'unknown'
  );
}

// Preset configs for different route types
export const RATE_LIMITS = {
  /** Public read routes: search, gallery, books, entities */
  public: { limit: 60, windowSeconds: 60 } as RateLimitConfig,
  /** Expensive routes: analytics, processing dashboard */
  expensive: { limit: 10, windowSeconds: 60 } as RateLimitConfig,
  /** Write routes: imports, processing triggers */
  write: { limit: 20, windowSeconds: 60 } as RateLimitConfig,
  /** Cron routes: should only fire a few times per window */
  cron: { limit: 5, windowSeconds: 60 } as RateLimitConfig,
} as const;
