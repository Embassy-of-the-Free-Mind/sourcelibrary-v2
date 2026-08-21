import type { NextRequest } from 'next/server';
import type { Db } from 'mongodb';
import { anonymizeIp } from '@/lib/anonymize-ip';
import { classifyTraffic, type TrafficClass } from '@/lib/traffic-classification';

/**
 * Shared ingestion-side traffic classification for the analytics write paths.
 *
 * `/api/track` (pageviews) has classified traffic at write time since the
 * traffic-class work landed, which is why `analytics_pageviews` is clean. The
 * book/page event sink at `/api/analytics/track` did not, and recorded no
 * user-agent at all — so `page_read` counted crawlers as readers with no way to
 * tell them apart afterwards. Over seven days that produced 839,701 `page_read`
 * events against 24,577 human book-page views (34×), and the reading-depth
 * histogram it feeds was measuring a headless fleet walking one page per book.
 * See #3405.
 *
 * The rule this module exists to enforce: **every collection that analytics
 * reads from must be classified at write time.** Retroactive classification is
 * impossible once the user-agent is gone.
 */

const SITE_HOST = 'sourcelibrary.org';

/** Normalize the request host into a tenant-identifying key. */
export function resolveHost(request: NextRequest): string {
  return resolveHostFromHeaders(request.headers);
}

/** Host key from a bare Headers bag (server contexts without a NextRequest). */
export function resolveHostFromHeaders(headers: Headers): string {
  const raw = (headers.get('x-forwarded-host') || headers.get('host') || SITE_HOST)
    .split(',')[0]
    .trim()
    .toLowerCase();
  return raw.replace(/:\d+$/, '').replace(/^www\./, '') || SITE_HOST;
}

/** Anonymized client IP (last octet zeroed) from the proxy headers. */
export function clientIp(request: NextRequest): string {
  return clientIpFromHeaders(request.headers);
}

/**
 * Anonymized client IP from a bare Headers bag.
 *
 * `cf-connecting-ip` FIRST, and this order is load-bearing. On the canonical
 * host the chain is client → Cloudflare → Vercel, and Vercel rewrites
 * `x-forwarded-for` with the address that connected to *it* — Cloudflare's
 * edge node. Reading `x-forwarded-for` first therefore recorded a CDN address
 * for every request that came through the front door: `analytics_pageviews`
 * and `analytics_events` were full of 172.64.0.0/13, 104.16.0.0/13 and
 * 162.158.0.0/15 rather than readers.
 *
 * The consequence was not cosmetic. Every IP-based defence downstream reads
 * these fields, so a distributed fleet arriving via Cloudflare was invisible
 * by construction — spread evenly across edge nodes, indistinguishable from
 * organic traffic. The one fleet we ever caught (AS132203, nine weeks) was
 * caught *because* it bypassed Cloudflare on an alias host, which is the only
 * reason its real addresses were ever written down. The per-IP event cap below
 * had the same blind spot: it was rate-limiting Cloudflare, not the caller.
 *
 * `src/lib/rate-limit.ts` has always had this order right; the analytics write
 * paths did not. Keep the two in agreement.
 */
export function clientIpFromHeaders(headers: Headers): string {
  const raw = headers.get('cf-connecting-ip')?.trim()
    || headers.get('true-client-ip')?.trim()
    || headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || headers.get('x-real-ip')
    || 'unknown';
  return anonymizeIp(raw);
}

// Per-IP daily cap for *events*, mirroring the pageview cap in /api/track.
// Deliberately generous: a human turning pages produces far more events than
// pageviews, but nobody reads 1,000 distinct pages in a day. Because the IP is
// already anonymized to a /24 this also bites a scraper that walks a subnet.
// Per serverless instance only — a distributed fleet still slips through, which
// is why traffic_class is stored rather than relied on as a complete filter.
const ipEvents = new Map<string, { count: number; resetAt: number }>();
const IP_EVENT_CAP = 1000;
const IP_WINDOW_MS = 24 * 60 * 60 * 1000;

function exceedsEventCap(ip: string): boolean {
  const now = Date.now();
  for (const [k, s] of ipEvents) if (now > s.resetAt) ipEvents.delete(k);
  let s = ipEvents.get(ip);
  if (!s || now > s.resetAt) {
    s = { count: 0, resetAt: now + IP_WINDOW_MS };
    ipEvents.set(ip, s);
  }
  s.count++;
  return s.count > IP_EVENT_CAP;
}

export interface ClassifiedRequest {
  cls: TrafficClass;
  isHuman: boolean;
  /** Server-side user-agent, truncated for storage. Empty string if absent. */
  userAgent: string;
  ip: string;
  host: string;
}

/**
 * Classify an inbound analytics write. The server-side UA header is
 * authoritative (a client-supplied one can be anything), and Cloudflare's bot
 * signals are folded in the same way `/api/track` folds them.
 */
export function classifyRequest(request: NextRequest): ClassifiedRequest {
  return classifyHeaders(request.headers);
}

/**
 * Same classification from a bare `Headers` bag, for server contexts that never
 * see a `NextRequest` — notably the NextAuth `events`/`sendVerificationRequest`
 * hooks, which receive no request object and can only reach the inbound headers
 * via `await headers()`.
 *
 * Deliberately the SAME function rather than a second implementation: the whole
 * point of this module is that there is one classifier, so a new write path
 * cannot be born contaminated (#3405).
 */
export function classifyHeaders(headers: Headers): ClassifiedRequest {
  const userAgent = (headers.get('user-agent') || '').slice(0, 200);
  const ip = clientIpFromHeaders(headers);
  const cfThreat = parseInt(headers.get('cf-threat-score') || '', 10);

  const cls = classifyTraffic(userAgent, {
    verifiedBot: headers.get('cf-verified-bot') === 'true',
    threatScore: Number.isFinite(cfThreat) ? cfThreat : undefined,
    rateCapped: exceedsEventCap(ip),
  });

  return { cls, isHuman: cls === 'human', userAgent, ip, host: resolveHostFromHeaders(headers) };
}

/**
 * Increment the compact per-day/host/class/event counter for a *dropped*
 * non-human event.
 *
 * Kept in its own collection rather than `analytics_traffic_class`: that one is
 * the pageview split shown on the traffic dashboard, and a single page view
 * fires both `/api/track` and one or more `/api/analytics/track` calls, so
 * folding events into it would double-count every visit.
 */
export async function recordDroppedEvent(
  db: Db,
  host: string,
  cls: TrafficClass,
  event: string
): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  await db.collection('analytics_events_class').updateOne(
    { _id: `${day}|${host}|${cls}|${event}` } as never,
    { $inc: { count: 1 }, $setOnInsert: { day, host, class: cls, event } },
    { upsert: true }
  );
}
