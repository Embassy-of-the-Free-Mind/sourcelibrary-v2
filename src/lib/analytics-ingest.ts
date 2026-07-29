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
  const raw = (request.headers.get('x-forwarded-host') || request.headers.get('host') || SITE_HOST)
    .split(',')[0]
    .trim()
    .toLowerCase();
  return raw.replace(/:\d+$/, '').replace(/^www\./, '') || SITE_HOST;
}

/** Anonymized client IP (last octet zeroed) from the proxy headers. */
export function clientIp(request: NextRequest): string {
  const raw = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
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
  const userAgent = (request.headers.get('user-agent') || '').slice(0, 200);
  const ip = clientIp(request);
  const cfThreat = parseInt(request.headers.get('cf-threat-score') || '', 10);

  const cls = classifyTraffic(userAgent, {
    verifiedBot: request.headers.get('cf-verified-bot') === 'true',
    threatScore: Number.isFinite(cfThreat) ? cfThreat : undefined,
    rateCapped: exceedsEventCap(ip),
  });

  return { cls, isHuman: cls === 'human', userAgent, ip, host: resolveHost(request) };
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
