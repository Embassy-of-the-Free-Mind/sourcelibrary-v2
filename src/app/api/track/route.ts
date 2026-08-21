import { NextRequest, NextResponse, after } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { clientIpFromHeaders } from '@/lib/analytics-ingest';
import { classifyTraffic, type TrafficClass } from '@/lib/traffic-classification';

const SITE_HOST = 'sourcelibrary.org';

// Normalize the request host into a tenant-identifying key. Strips port and a
// leading www.; falls back to the canonical site host.
function resolveHost(request: NextRequest): string {
  const raw = (request.headers.get('x-forwarded-host') || request.headers.get('host') || SITE_HOST)
    .split(',')[0]
    .trim()
    .toLowerCase();
  return raw.replace(/:\d+$/, '').replace(/^www\./, '') || SITE_HOST;
}

// Increment the compact per-day/host/class counter. This is the ONLY place
// non-human traffic is recorded (bots/AI are not stored as full pageviews), and
// because it's tiny + aggregated it carries no TTL — it's our long-term
// human-vs-bot-vs-AI history, surviving the 90-day pageview TTL.
async function recordClass(
  db: Awaited<ReturnType<typeof getDb>>,
  host: string,
  cls: TrafficClass
): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  await db.collection('analytics_traffic_class').updateOne(
    { _id: `${day}|${host}|${cls}` } as never,
    { $inc: { count: 1 }, $setOnInsert: { day, host, class: cls } },
    { upsert: true }
  );
}

// Rate limiting: in-memory dedup cache (persists within a single serverless instance)
const recentHits = new Map<string, number>();
const DEDUP_WINDOW_MS = 60_000; // 60 seconds

// Per-IP daily cap: catches spoofed-UA scrapers that pass the bot regex.
// Tracks count + distinct user-agents per IP over a 24h window. An IP that
// crosses the cap with only one UA fingerprint is dropped — real users cycle
// through paths via 1 UA but rarely exceed 500 logged pageviews/day after
// 60s dedup. Per-instance only (Vercel serverless); good enough for the
// single-IP scrapers we've seen (BG/RO/RS hitting 400-700 views/day).
const ipStats = new Map<string, { count: number; uas: Set<string>; resetAt: number }>();
const IP_DAILY_CAP = 500;
const IP_WINDOW_MS = 24 * 60 * 60 * 1000;

// Periodic cleanup to prevent memory leaks
let lastCleanup = Date.now();
function cleanupRecentHits() {
  const now = Date.now();
  if (now - lastCleanup < DEDUP_WINDOW_MS) return;
  lastCleanup = now;
  for (const [key, ts] of recentHits) {
    if (now - ts > DEDUP_WINDOW_MS) recentHits.delete(key);
  }
  for (const [ip, s] of ipStats) {
    if (now > s.resetAt) ipStats.delete(ip);
  }
}

function isDuplicate(ip: string, path: string): boolean {
  cleanupRecentHits();
  const key = `${ip}:${path}`;
  const now = Date.now();
  const lastHit = recentHits.get(key);
  if (lastHit && now - lastHit < DEDUP_WINDOW_MS) return true;
  recentHits.set(key, now);
  return false;
}

function exceedsIpCap(ip: string, ua: string): boolean {
  const now = Date.now();
  let s = ipStats.get(ip);
  if (!s || now > s.resetAt) {
    s = { count: 0, uas: new Set(), resetAt: now + IP_WINDOW_MS };
    ipStats.set(ip, s);
  }
  s.count++;
  s.uas.add(ua.slice(0, 60));
  return s.count > IP_DAILY_CAP && s.uas.size <= 1;
}

// Bound deferred DB work so a slow Atlas write doesn't hold the serverless slot.
const DB_TIMEOUT_MS = 3000;

const OK = NextResponse.json({ success: true });

/** Run a best-effort write after the HTTP response is sent (Next.js after()). */
function deferDbWrite(work: () => Promise<void>): void {
  const bounded = async () => {
    try {
      await Promise.race([
        work(),
        new Promise<void>((resolve) => setTimeout(resolve, DB_TIMEOUT_MS)),
      ]);
    } catch {
      // Analytics must never throw to the client or fail the background task loudly.
    }
  };
  try {
    after(bounded);
  } catch {
    // Tests / non-request contexts without after() scope — still attempt the write.
    void bounded();
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    // Support both formats: { path, referrer, userAgent } and { event, properties: { path, referrer, userAgent } }
    const { path, referrer, userAgent } = body.properties || body;

    // Use server-side UA header as authoritative (client can be spoofed)
    const serverUA = request.headers.get('user-agent');
    const effectiveUA = serverUA || userAgent;
    const host = resolveHost(request);

    // Cloudflare bot-management signals (we're behind CF).
    const cfVerifiedBot = request.headers.get('cf-verified-bot') === 'true';
    const cfThreat = parseInt(request.headers.get('cf-threat-score') || '', 10);

    // Shared with /api/analytics/track so both pageview and event streams key
    // on the same address. Reads cf-connecting-ip first — see the note on
    // clientIpFromHeaders for why the previous header order recorded Cloudflare
    // edge nodes instead of readers.
    const ip = clientIpFromHeaders(request.headers);

    // Spoofed-UA scrapers that pass the UA check are caught by the per-IP cap.
    const rateCapped = exceedsIpCap(ip, effectiveUA || '');

    const cls = classifyTraffic(effectiveUA, {
      verifiedBot: cfVerifiedBot,
      threatScore: Number.isFinite(cfThreat) ? cfThreat : undefined,
      rateCapped,
    });

    // Non-human traffic: record the compact class counter only, no pageview.
    if (cls !== 'human') {
      deferDbWrite(async () => {
        await recordClass(await getDb(), host, cls);
      });
      return OK;
    }

    // Human: rate-limit same IP + path within 60s (don't double-count reloads).
    if (path && isDuplicate(ip, path)) {
      return OK;
    }

    // Parse referrer — filter out self-referrals
    let referrerDomain = 'direct';
    if (referrer) {
      try {
        const url = new URL(referrer);
        const hostname = url.hostname.replace('www.', '');
        if (hostname !== SITE_HOST) {
          referrerDomain = hostname;
        }
      } catch {
        referrerDomain = referrer.split('/')[2] || 'unknown';
      }
    }

    // Detect country (basic - from IP via headers)
    const country = request.headers.get('x-vercel-ip-country') || request.headers.get('cf-ipcountry') || 'Unknown';

    deferDbWrite(async () => {
      const db = await getDb();
      await Promise.all([
        db.collection('analytics_pageviews').insertOne({
          path,
          referrer: referrerDomain,
          country,
          host,
          userAgent: (effectiveUA || userAgent)?.substring(0, 200),
          timestamp: new Date(),
          ip,
        }),
        recordClass(db, host, 'human'),
      ]);
    });

    return OK;
  } catch {
    // Silently succeed — analytics must never error to the client
    return OK;
  }
}
