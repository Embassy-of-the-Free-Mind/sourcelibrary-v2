import { after, type NextRequest } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { classifyRequest } from '@/lib/analytics-ingest';

/**
 * The single writer for `analytics_events` `shortlink_visit` documents (#2047).
 *
 * `/q/<code>` is the canonical share format — the reader copies it, pastes it
 * into Slack or a footnote, and somebody else clicks it. Until this existed the
 * arrival was invisible: the route answers 302 before any page renders, so no
 * client-side `/api/track` pageview ever fires, and `search → book → quote →
 * share → arrive` had its last step permanently dark (0 events out of ~136K in
 * the 30-day deep dive). The destination pageview is recorded, but it is
 * byte-identical to a Google click on the same page, so it cannot answer "which
 * books get shared" or "which channels send readers".
 *
 * Two things this module is careful about:
 *
 * 1. **The redirect must never wait on Mongo.** The write is deferred with
 *    `after()` and raced against a short timeout, the same shape as
 *    `/api/track`. A slow Atlas costs us the row, never the reader's hop.
 * 2. **Traffic is classified at WRITE time**, via the shared
 *    `classifyRequest()`. Non-human hits are STORED and tagged rather than
 *    dropped — the same choice as `/api/analytics/event`, and for the same
 *    reason: shortlinks are click-driven and low-volume, and the unfurl bots
 *    (Slack, Twitter, mail scanners) ARE part of the finding when a share
 *    "gets clicks" that were never people. Read paths filter on
 *    `traffic_class: 'human'`. See CLAUDE.md, "The measurement layer fails
 *    silently, and always toward good news", and #3405.
 */

const DEDUP_WINDOW_MS = 60_000;
const DB_TIMEOUT_MS = 3000;
const SITE_HOST = 'sourcelibrary.org';

// Per-instance dedup on ip + code, mirroring the pageview dedup in /api/track:
// a reader who reloads the shared link, or a client that prefetches it before
// following it, is one visit and not three.
const recentHits = new Map<string, number>();
let lastCleanup = Date.now();

function isDuplicate(key: string): boolean {
  const now = Date.now();
  if (now - lastCleanup >= DEDUP_WINDOW_MS) {
    lastCleanup = now;
    for (const [k, ts] of recentHits) if (now - ts > DEDUP_WINDOW_MS) recentHits.delete(k);
  }
  const last = recentHits.get(key);
  if (last && now - last < DEDUP_WINDOW_MS) return true;
  recentHits.set(key, now);
  return false;
}

/** Referring domain, with self-referrals collapsed the way /api/track does. */
function referrerDomain(request: NextRequest): string {
  const raw = request.headers.get('referer') || request.headers.get('referrer');
  if (!raw) return 'direct';
  try {
    const hostname = new URL(raw).hostname.replace(/^www\./, '');
    // A tenant subdomain is still us — collapse anything under the site host.
    if (hostname === SITE_HOST || hostname.endsWith(`.${SITE_HOST}`)) return 'direct';
    return hostname.slice(0, 200);
  } catch {
    return (raw.split('/')[2] || 'unknown').slice(0, 200);
  }
}

export interface ShortlinkVisitInput {
  request: NextRequest;
  /** The base62 code as it appeared in the URL. */
  code: string;
  /** Decoded book id. */
  bookId: string;
  /** Decoded page number — the shortlink always carries one, but keep it nullable. */
  pageNumber: number | null;
  /** Resolved page id, or null when the page was not found and we fell back to the book. */
  targetPageId: string | null;
}

/**
 * Record one shortlink arrival. Never throws, never awaited by the caller.
 *
 * Call it only once the code has DECODED — an invalid shortlink is a 404-shaped
 * event about a bad URL, not a share arriving, and logging it would put junk
 * codes in the "most shared" ranking.
 */
export function logShortlinkVisit(input: ShortlinkVisitInput): void {
  try {
    const { cls, userAgent, ip, host } = classifyRequest(input.request);
    if (isDuplicate(`${ip}:${input.code}`)) return;

    const now = new Date();
    const doc = {
      event: 'shortlink_visit',
      code: input.code.slice(0, 64),
      book_id: input.bookId,
      page_number: input.pageNumber,
      target_page_id: input.targetPageId,
      // The tenant the link was opened ON (bph.sourcelibrary.org/q/…), stamped
      // by the proxy. Null on the canonical host. Note this is the reading room
      // the reader arrived through, not the book's owning tenant.
      tenant: input.request.headers.get('x-tenant-slug') || null,
      tenantId: input.request.headers.get('x-tenant-id') || null,
      referrer: referrerDomain(input.request),
      country:
        input.request.headers.get('x-vercel-ip-country') ||
        input.request.headers.get('cf-ipcountry') ||
        'Unknown',
      ip,
      user_agent: userAgent,
      traffic_class: cls,
      host,
      timestamp: now,
      created_at: now,
    };

    const write = async () => {
      try {
        await Promise.race([
          (async () => {
            const db = await getDb();
            await db.collection('analytics_events').insertOne(doc);
          })(),
          new Promise<void>((resolve) => setTimeout(resolve, DB_TIMEOUT_MS)),
        ]);
      } catch {
        // Analytics must never affect the redirect.
      }
    };

    try {
      after(write);
    } catch {
      // Tests / contexts without an after() scope — still attempt the write.
      void write();
    }
  } catch {
    // Classification or header access failed; drop the row, keep the redirect.
  }
}
