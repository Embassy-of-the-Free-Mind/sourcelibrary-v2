import { NextRequest, NextResponse } from 'next/server';
import { compareSearch } from '@/lib/search/compare-search';
import { resolveTenantId } from '@/lib/tenant-context';

export const preferredRegion = 'fra1';

// GET /api/search/compare?q=...&tenant=bph
// Returns the same tenant-scoped candidate set in two orderings (ladder vs rrf)
// for the librarian compare page. Tenant is explicit (not header-derived) so it
// works on a preview deploy where there's no tenant subdomain.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get('q') || '').trim();
  const tenantSlug = (searchParams.get('tenant') || '').trim();
  // scope=global searches the whole Source Library; default 'tenant' restricts
  // to the tenant's corpus. Global is an intentional internal-eval option on
  // this librarian tool — it is NOT the public reading room.
  const scope = searchParams.get('scope') === 'global' ? 'global' : 'tenant';

  if (query.length < 2) {
    return NextResponse.json({ error: 'Query must be at least 2 characters' }, { status: 400 });
  }
  if (!tenantSlug) {
    return NextResponse.json({ error: 'tenant is required' }, { status: 400 });
  }
  const tenantId = await resolveTenantId(tenantSlug);
  if (!tenantId) {
    return NextResponse.json({ error: `Unknown tenant: ${tenantSlug}` }, { status: 404 });
  }

  try {
    const result = await compareSearch(query, tenantId, tenantSlug, scope);
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    });
  } catch (error) {
    console.error('[search/compare] error:', error);
    return NextResponse.json(
      { error: 'Compare search failed', message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
