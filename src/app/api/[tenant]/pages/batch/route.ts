import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { resolveTenantId } from '@/lib/tenant-context';
import { markPageForReader } from '@/lib/provenance';
import { gatePagesForRequest } from '@/lib/metered-gate';
import { meteredReaderEnabled } from '@/lib/free-preview';

export const preferredRegion = 'fra1';

/**
 * POST /api/[tenant]/pages/batch
 *
 * Fetch multiple pages by ID in a single request.
 * Body: { ids: string[] }
 * Returns: { pages: Page[] }
 *
 * Used by the reader to prefetch adjacent pages without
 * firing N individual requests (which triggers rate limiting).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenant: string }> }
) {
  try {
    const { tenant } = await params;
    const body = await request.json();
    const ids: string[] = body.ids;
    
    // Resolve tenant slug to UUID
    const tenantId = await resolveTenantId(tenant);
    if (!tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'ids array is required' }, { status: 400 });
    }

    // Cap at 20 pages per request
    const limitedIds = ids.slice(0, 20);

    // Default tenant = the main library: untagged (global) pages are in scope.
    // Subdomain tenants stay strict. Mirrors the [id] GET route and
    // findTenantBookByIdOrSlug() — keeps reader prefetch working on untagged
    // books instead of silently returning an empty batch.
    const tenantFilter = tenant === 'default' ? { $in: [tenantId, null] } : tenantId;

    const db = await getDb();
    let pages = await db.collection('pages').find(
      { id: { $in: limitedIds }, tenantId: tenantFilter },
      { projection: { detected_images: 0 } }
    ).toArray();

    // Metered reader (#4357): 'default' tenant = the main library, metered
    // like the global twin; named tenants are exempt partner reading rooms.
    // No-op unless METERED_READER=1.
    pages = await gatePagesForRequest(db, request, pages, { exempt: tenant !== 'default' });

    // Strip MongoDB _id; weave the reader-path provenance mark into each
    // translation (deterministic, cache-safe — mirrors the global twin).
    const cleaned = pages.map(({ _id, ...rest }) => markPageForReader(rest));

    // With metering on, the body depends on who asked — keep it out of any
    // shared cache (POSTs aren't CDN-cached today; belt and braces).
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
