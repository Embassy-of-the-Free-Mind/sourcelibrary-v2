import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

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

// Periodic cleanup to prevent memory leaks
let lastCleanup = Date.now();
function cleanupRecentHits() {
  const now = Date.now();
  if (now - lastCleanup < DEDUP_WINDOW_MS) return;
  lastCleanup = now;
  for (const [key, ts] of recentHits) {
    if (now - ts > DEDUP_WINDOW_MS) recentHits.delete(key);
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
    if (isBot(effectiveUA)) {
      return NextResponse.json({ success: true });
    }

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

    // Rate limit: same IP + path within 60s = skip
    if (path && isDuplicate(ip, path)) {
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
