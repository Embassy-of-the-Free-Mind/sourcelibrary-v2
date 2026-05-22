import { NextRequest, NextResponse } from 'next/server';
import { lookupAuthor } from '@/lib/author-authority';

/**
 * GET /api/authority/author/search?q=<string>&limit=<n>
 *
 * Looks up canonical author identity for a free-text name. Proxies to VIAF
 * AutoSuggest + per-cluster enrichment (see src/lib/author-authority.ts).
 * Results are cached in MongoDB `entities` so repeat queries are cheap.
 *
 * Response:
 *   {
 *     query: string,
 *     normalised_query: string,
 *     matches: AuthorAuthorityMatch[]
 *   }
 *
 * Public — VIAF and Wikidata are public bibliographic data. The editor UI
 * gates "Use this" behind the same role check that gates the underlying
 * mutation endpoint (catalog edit / book PATCH).
 *
 * Issue #1921 (P3).
 */

// In-memory rate limit: cap per-IP requests to roughly debounce abuse.
// Not a security mechanism — the upstream APIs are public — just a "don't
// burn the user's debouncer hammering us" guard.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60; // 60 lookups/minute per ip — comfortably above keystrokes after debounce.
const rateLimitState = new Map<string, { count: number; resetAt: number }>();

function rateLimitHit(ip: string): boolean {
  const now = Date.now();
  const cur = rateLimitState.get(ip);
  if (!cur || cur.resetAt < now) {
    rateLimitState.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  cur.count += 1;
  return cur.count > RATE_LIMIT_MAX;
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const q = (sp.get('q') || '').trim();
  const limit = Math.min(10, Math.max(1, Number(sp.get('limit') || '5')));

  if (!q) {
    return NextResponse.json(
      { error: 'Missing query parameter `q`' },
      { status: 400 },
    );
  }
  if (q.length > 200) {
    return NextResponse.json(
      { error: 'Query too long' },
      { status: 400 },
    );
  }

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';
  if (rateLimitHit(ip)) {
    return NextResponse.json(
      { error: 'Rate limit exceeded — try again in a minute' },
      { status: 429 },
    );
  }

  try {
    const result = await lookupAuthor(q, { limit });
    // 24h cache header — clients (and Vercel edge) can deduplicate. The
    // underlying VIAF/Wikidata calls already use `next.revalidate: 86400`
    // for the same reason.
    return NextResponse.json(result, {
      headers: {
        'cache-control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=86400',
      },
    });
  } catch (err) {
    console.error('[/api/authority/author/search] error', err);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
}
