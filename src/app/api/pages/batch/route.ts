import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { getTenantContextFromRequest } from '@/lib/tenant-context';
import { markPageForReader } from '@/lib/provenance';
import { gatePagesForRequest } from '@/lib/metered-gate';
import { meteredReaderEnabled } from '@/lib/free-preview';

export const preferredRegion = 'fra1';

/**
 * POST /api/pages/batch
 *
 * Fetch multiple pages by ID in a single request.
 * Body: { ids: string[] }
 * Returns: { pages: Page[] }
 *
 * Used by the reader to prefetch adjacent pages without
 * firing N individual requests (which triggers rate limiting).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const ids: string[] = body.ids;
    const { id: tenantId } = getTenantContextFromRequest(request);

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'ids array is required' }, { status: 400 });
    }

    // Cap at 20 pages per request
    const limitedIds = ids.slice(0, 20);

    // Tenant subdomains and /[tenant]/... paths get tenantId injected by the
    // proxy and stay tenant-scoped. Calls from the global main domain arrive
    // with no tenantId — those are allowed to read globally (same semantics
    // as the unscoped GET /api/pages/[id] route).
    const filter: Record<string, unknown> = { id: { $in: limitedIds } };
    if (tenantId) filter.tenantId = tenantId;

    const db = await getDb();
    let pages = await db.collection('pages').find(
      filter,
      { projection: { detected_images: 0 } }
    ).toArray();

    // Metered reader (#4357): strip gated text for anonymous callers beyond
    // each book's free sample. Tenant-scoped requests are exempt. No-op
    // unless METERED_READER=1.
    pages = await gatePagesForRequest(db, request, pages, { exempt: !!tenantId });

    // Strip MongoDB _id; weave the reader-path provenance mark into each
    // translation. Deterministic (content-keyed, no ref), so the shared
    // s-maxage cache below serves identical bytes to every caller.
    const cleaned = pages.map(({ _id, ...rest }) => markPageForReader(rest));

    // With metering on, the body depends on who asked (session vs anon) —
    // never let a shared cache serve one caller's variant to another. POSTs
    // aren't CDN-cached today, so this is belt and braces, not a behavior
    // change for the flag-off default.
    const cacheControl = meteredReaderEnabled()
      ? 'private, no-store'
      : 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';

    return NextResponse.json({ pages: cleaned }, {
      headers: { 'Cache-Control': cacheControl },
    });
  } catch (error) {
    console.error('Batch pages error:', error);
    return NextResponse.json({ error: 'Failed to fetch pages' }, { status: 500 });
  }
}
