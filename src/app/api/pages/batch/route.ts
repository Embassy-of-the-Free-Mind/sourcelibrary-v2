import { NextRequest, NextResponse } from 'next/server';
import { primeHuntPayloads } from '@/lib/hunt-payloads';
import { getDb } from '@/lib/mongodb';
import { getTenantContextFromRequest } from '@/lib/tenant-context';
import { findUntaggedPagesOfTenantBooks } from '@/lib/tenant-page-scope';
import { serveEnglishOriginalPages } from '@/lib/english-original-text';
import { markPageForReader } from '@/lib/provenance';
import { gatePagesForRequest } from '@/lib/metered-gate';
import { isScriptOnPartnerPages, SURFACE_REFUSED_RESPONSE } from '@/lib/partner-access';
import { meteredReaderEnabled } from '@/lib/free-preview';
import { poolRefFor } from '@/lib/suspected-pool';
import { PAGE_API_LAYER_PROJECTION } from '@/lib/reader-page-projection'; // detected_images stays out
import { takeReaderTextLayers, applyReaderTextLayer } from '@/lib/reader-text-layer'; // #7965: the notes layer; text/text_from stripped here

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
      { projection: PAGE_API_LAYER_PROJECTION }
    ).toArray();

    // A tenant's book can have untagged page rows; the reader's Referer brings the tenant here.
    if (tenantId) {
      const found = new Set(pages.map(p => p.id));
      const missing = limitedIds.filter(id => !found.has(id));
      pages = pages.concat(await findUntaggedPagesOfTenantBooks(db, missing, tenantId, PAGE_API_LAYER_PROJECTION));
    }

    if (await isScriptOnPartnerPages(request, db, pages)) {
      return new NextResponse(SURFACE_REFUSED_RESPONSE, { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
    }

    // The notes layer (#7965): read while the pages still carry translation.text, which goes no further.
    const taken = await takeReaderTextLayers(db, pages);
    pages = taken.pages;

    // Metered reader (#4357): strip gated text for anonymous callers beyond
    // each book's free sample. Tenant-scoped requests are exempt. No-op
    // unless METERED_READER=1.
    pages = await gatePagesForRequest(db, request, pages, { exempt: !!tenantId });

    // English edition, English leaf: serve the transcription, never the stored
    // English-to-English rewording (#7100).
    pages = await serveEnglishOriginalPages(db, pages);

    // Strip MongoDB _id; weave the reader-path provenance mark into each
    // translation. Deterministic (content-keyed, no ref) for readers, so the
    // shared s-maxage cache below serves identical bytes to every caller. A
    // flagged proxy pool also gets its extraction ref (#6950) and a
    // private, no-store response.
    const ref = await poolRefFor(request);
    await primeHuntPayloads(); // #8150: riddle colophons, chosen by book
    const cleaned = pages.map(({ _id, ...rest }) => markPageForReader(applyReaderTextLayer(rest, taken.layers), undefined, { ref }));

    // With metering on, the body depends on who asked (session vs anon) —
    // never let a shared cache serve one caller's variant to another. POSTs
    // aren't CDN-cached today, so this is belt and braces, not a behavior
    // change for the flag-off default.
    const cacheControl = ref || meteredReaderEnabled()
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
