/**
 * Views API — durable first-party view counters.
 *
 * POST /api/views - Record a view (fire-and-forget beacon from the client)
 * GET  /api/views - Get view counts for a batch of targets
 *
 * Why this exists: the only per-item view signals were GA `view_item` events
 * (consent-gated, captures almost nothing) and `analytics_pageviews`
 * (path-level, 90-day TTL, misses in-lightbox navigation). This collection
 * keeps a tiny permanent counter per target so "most viewed" is a real,
 * queryable thing — same target keying as the likes system.
 *
 * Storage: `views` collection, one doc per target:
 *   { target_type, target_id, count, created_at, updated_at }
 * Index (created 2026-06-03): unique on (target_type, target_id).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { clientIpFromHeaders } from '@/lib/analytics-ingest';
import { classifyTraffic } from '@/lib/traffic-classification';

const VALID_TYPES = ['image', 'page', 'book'] as const;
const TARGET_ID_RE = /^[\w:.-]{1,128}$/;

// Same in-memory dedup pattern as /api/track: don't double-count the same
// visitor hammering the same target within the window (reloads, re-renders).
// Per-serverless-instance, which is good enough for a counter.
const recentHits = new Map<string, number>();
const DEDUP_WINDOW_MS = 60_000;
let lastCleanup = Date.now();

function isDuplicate(ip: string, target: string): boolean {
  const now = Date.now();
  if (now - lastCleanup > DEDUP_WINDOW_MS) {
    lastCleanup = now;
    for (const [key, ts] of recentHits) {
      if (now - ts > DEDUP_WINDOW_MS) recentHits.delete(key);
    }
  }
  const key = `${ip}:${target}`;
  const lastHit = recentHits.get(key);
  if (lastHit && now - lastHit < DEDUP_WINDOW_MS) return true;
  recentHits.set(key, now);
  return false;
}

/**
 * Image targetIds come in `{pageId}-{detectionIndex}` (current UI) and legacy
 * `{pageId}:{detectionIndex}` forms — normalize to the hyphen form so both
 * spellings increment the same counter. Matches the gallery URL shape.
 */
function normalizeTargetId(targetType: string, targetId: string): string {
  if (targetType === 'image') return targetId.replace(':', '-');
  return targetId;
}

// Views are non-critical — never hold a serverless slot on a slow DB.
const DB_TIMEOUT_MS = 3000;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { target_type } = body;
    const target_id = typeof body.target_id === 'string'
      ? normalizeTargetId(target_type, body.target_id)
      : null;

    if (!VALID_TYPES.includes(target_type) || !target_id || !TARGET_ID_RE.test(target_id)) {
      return NextResponse.json({ success: true });
    }

    // Bot filter — same Cloudflare signals as /api/track. Scrapers must not
    // inflate counters.
    const ua = request.headers.get('user-agent') || '';
    const cfVerifiedBot = request.headers.get('cf-verified-bot') === 'true';
    const cfThreat = parseInt(request.headers.get('cf-threat-score') || '', 10);
    const cls = classifyTraffic(ua, {
      verifiedBot: cfVerifiedBot,
      threatScore: Number.isFinite(cfThreat) ? cfThreat : undefined,
    });
    if (cls !== 'human') {
      return NextResponse.json({ success: true });
    }

    // Must be the CALLER, not the CDN: this address dedupes view increments,
    // so a Cloudflare edge IP collapses every reader behind that node into one
    // and silently suppresses real views. read_count also orders the paid
    // re-OCR queues, so a wrong denominator here spends money in the wrong place.
    const ip = clientIpFromHeaders(request.headers);
    if (isDuplicate(ip, `${target_type}:${target_id}`)) {
      return NextResponse.json({ success: true });
    }

    const dbWrite = (async () => {
      const db = await getDb();
      await db.collection('views').updateOne(
        { target_type, target_id },
        {
          $inc: { count: 1 },
          $set: { updated_at: new Date() },
          $setOnInsert: { created_at: new Date() },
        },
        { upsert: true }
      );
    })();
    const timeout = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), DB_TIMEOUT_MS)
    );
    await Promise.race([dbWrite, timeout]);

    return NextResponse.json({ success: true });
  } catch {
    // Analytics must never error to the client
    return NextResponse.json({ success: true });
  }
}

/**
 * GET /api/views?targets=[{"type":"image","id":"abc-0"}]
 *
 * Batch view counts, same request/response shape as GET /api/likes:
 * { results: { "image:abc-0": { count: 12 } } }
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const targetsJson = searchParams.get('targets');
    if (!targetsJson) {
      return NextResponse.json({ error: 'targets parameter is required' }, { status: 400 });
    }

    let targets: Array<{ type: string; id: string }>;
    try {
      targets = JSON.parse(targetsJson);
    } catch {
      return NextResponse.json({ error: 'Invalid targets JSON' }, { status: 400 });
    }
    if (!Array.isArray(targets) || targets.length === 0) {
      return NextResponse.json({ results: {} });
    }
    targets = targets.slice(0, 100)
      .filter(t => VALID_TYPES.includes(t.type as typeof VALID_TYPES[number]) && typeof t.id === 'string')
      .map(t => ({ type: t.type, id: normalizeTargetId(t.type, t.id) }));

    const db = await getDb();
    const docs = await db.collection('views').find({
      $or: targets.map(t => ({ target_type: t.type, target_id: t.id })),
    }, { projection: { target_type: 1, target_id: 1, count: 1 } }).toArray();

    const results: Record<string, { count: number }> = {};
    for (const t of targets) {
      results[`${t.type}:${t.id}`] = { count: 0 };
    }
    for (const d of docs) {
      const key = `${d.target_type}:${d.target_id}`;
      if (results[key]) results[key].count = d.count || 0;
    }

    return NextResponse.json({ results }, {
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get views' },
      { status: 500 }
    );
  }
}
