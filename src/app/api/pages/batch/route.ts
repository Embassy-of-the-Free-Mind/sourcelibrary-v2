import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { getTenantContextFromRequest } from '@/lib/tenant-context';
import { markPageForReader } from '@/lib/provenance';

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
    const pages = await db.collection('pages').find(
      filter,
      { projection: { detected_images: 0 } }
    ).toArray();

    // Strip MongoDB _id; weave the reader-path provenance mark into each
    // translation. Deterministic (content-keyed, no ref), so the shared
    // s-maxage cache below serves identical bytes to every caller.
    const cleaned = pages.map(({ _id, ...rest }) => markPageForReader(rest));

    return NextResponse.json({ pages: cleaned }, {
      headers: { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' },
    });
  } catch (error) {
    console.error('Batch pages error:', error);
    return NextResponse.json({ error: 'Failed to fetch pages' }, { status: 500 });
  }
}
