import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { anonymizeIp } from '@/lib/anonymize-ip';

const SITE_HOST = 'sourcelibrary.org';

// Bot detection patterns
const BOT_PATTERNS = /bot|crawler|spider|headlesschrome|googleother|vercel-screenshot|slurp|bingpreview|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegrambot|applebot|yandexbot|baiduspider|duckduckbot|semrush|ahrefs|mj12bot|dotbot|petalbot|bytespider/i;

function isBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  return BOT_PATTERNS.test(userAgent);
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

// Cloudflare bot-management signals (we're behind CF). cf-verified-bot is
// true for legit crawlers we don't want either; cf-threat-score is 0-100
// (higher = worse). Drop anything CF already classifies as a bot.
function isCloudflareBot(request: NextRequest): boolean {
  if (request.headers.get('cf-verified-bot') === 'true') return true;
  const threat = parseInt(request.headers.get('cf-threat-score') || '', 10);
  if (Number.isFinite(threat) && threat >= 30) return true;
  return false;
}

// DB write timeout — analytics is fire-and-forget, don't hold a serverless slot for 30s+
const DB_TIMEOUT_MS = 3000;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    // Support both formats: { path, referrer, userAgent } and { event, properties: { path, referrer, userAgent } }
    const { path, referrer, userAgent } = body.properties || body;

    // Use server-side UA header as authoritative (client can be spoofed)
    const serverUA = request.headers.get('user-agent');
    const effectiveUA = serverUA || userAgent;

    // Drop bot traffic entirely — no DB write
    if (isBot(effectiveUA) || isCloudflareBot(request)) {
      return NextResponse.json({ success: true });
    }

    const rawIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const ip = anonymizeIp(rawIp);

    // Rate limit: same IP + path within 60s = skip
    if (path && isDuplicate(ip, path)) {
      return NextResponse.json({ success: true });
    }

    // Per-IP daily cap with UA-diversity check (drops spoofed-UA scrapers)
    if (exceedsIpCap(ip, effectiveUA || '')) {
      return NextResponse.json({ success: true });
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

    // Race DB write against a short timeout — analytics is non-critical,
    // don't hold a serverless function slot during DB degradation
    const dbWrite = (async () => {
      const db = await getDb();
      await db.collection('analytics_pageviews').insertOne({
        path,
        referrer: referrerDomain,
        country,
        userAgent: (effectiveUA || userAgent)?.substring(0, 200),
        timestamp: new Date(),
        ip,
      });
    })();

    const timeout = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), DB_TIMEOUT_MS)
    );

    const result = await Promise.race([dbWrite, timeout]);
    if (result === 'timeout') {
      // DB is slow — return 200 anyway, drop the pageview
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: true });
  } catch {
    // Silently succeed — analytics must never error to the client
    return NextResponse.json({ success: true });
  }
}
