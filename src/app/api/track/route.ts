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

    const db = await getDb();

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

    // Insert analytics record
    await db.collection('analytics_pageviews').insertOne({
      path,
      referrer: referrerDomain,
      country,
      userAgent: (effectiveUA || userAgent)?.substring(0, 200),
      timestamp: new Date(),
      ip,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Track error:', error);
    return NextResponse.json(
      { error: 'Failed to track pageview' },
      { status: 500 }
    );
  }
}
