import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { getReadDb } from '@/lib/mongodb';
import { getTenantContextFromRequest, resolveTenantId } from '@/lib/tenant-context';
import { resolveSearchScope } from '@/lib/tenant-search-scope';
import { computeGalleryStats, galleryStatsKey, TooBroadError, type GalleryStats } from '@/lib/gallery-stats';

export const maxDuration = 30;

const NONE: GalleryStats = { total: 0, plates: 0, books: 0, artworks: 0, printed: [], yearFirst: null, yearLast: null, kinds: [] };

/**
 * GET /api/gallery/stats — the gallery's stats band for the same parameters
 * /api/gallery takes: images, books, artworks, when printed, kinds of image.
 * Counted with /api/gallery's own filters (src/lib/gallery-stats.ts). Global
 * requests are cached an hour per filter set and shared; a tenant's are
 * computed per request and never stored in a shared cache (see
 * galleryCacheControl in ../route.ts for why).
 */
export async function GET(request: NextRequest) {
  const sp = new URL(request.url).searchParams;
  try {
    const tenantCtx = getTenantContextFromRequest(request);
    let tenantId = tenantCtx.id;
    if (!tenantId && tenantCtx.slug) tenantId = await resolveTenantId(tenantCtx.slug);
    const tenantScoped = Boolean(tenantId || tenantCtx.id || tenantCtx.slug);
    const scope = await resolveSearchScope(request);
    if (scope.kind === 'closed') return NextResponse.json(NONE, { headers: { 'Cache-Control': 'private, no-store' } });
    const tenantBooks = scope.kind === 'tenant' ? [{ book_id: { $in: scope.bookIds } }] : null;

    const compute = async () => computeGalleryStats(await getReadDb(), sp, { tenantId: tenantId ?? null, tenantBooks });
    const stats = tenantScoped
      ? await compute()
      : await unstable_cache(compute, ['gallery-stats-v3', galleryStatsKey(sp)], { revalidate: 3600, tags: ['gallery-stats'] })();
    return NextResponse.json(stats, {
      headers: { 'Cache-Control': tenantScoped ? 'private, no-store' : 'public, max-age=0, s-maxage=600, stale-while-revalidate=3600' },
    });
  } catch (err) {
    if (err instanceof TooBroadError) {
      return NextResponse.json({ error: 'Too broad to count' }, { status: 422, headers: { 'Cache-Control': 'public, max-age=0, s-maxage=3600' } });
    }
    console.error('[gallery/stats]', (err as Error)?.message);
    return NextResponse.json({ error: 'Failed to count the gallery' }, { status: 500 });
  }
}
