import { timingSafeEqual } from 'node:crypto';

/**
 * Internal warm-ping: the header our own cache warmers and eval scripts send
 * so their requests skip the anonymous AI and search allowances (anon-gate.ts).
 *
 * The header only counts when its value equals CRON_SECRET (constant-time
 * compare). With no CRON_SECRET configured nothing is exempt.
 */
export const WARM_PING_HEADER = 'x-warm-ping';

/** Headers a server-side warmer attaches. Empty when CRON_SECRET is unset. */
export function warmPingHeaders(): Record<string, string> {
  const secret = process.env.CRON_SECRET;
  return secret ? { 'X-Warm-Ping': secret } : {};
}

export function isWarmPing(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const value = request.headers.get(WARM_PING_HEADER);
  if (!secret || !value) return false;
  const a = Buffer.from(value);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
