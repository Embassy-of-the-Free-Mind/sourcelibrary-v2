import { NextRequest, NextResponse } from 'next/server';
import { getRevisions } from '@/lib/page-revisions';
import { resolveTenantId } from '@/lib/tenant-context';
import { getDb } from '@/lib/mongodb';
import { findUntaggedPagesOfTenantBooks } from '@/lib/tenant-page-scope';
import { pageGateForRequest, meteredSignInResponse } from '@/lib/metered-gate';

/**
 * GET /api/[tenant]/pages/[id]/revisions?field=ocr&limit=50&offset=0
 *
 * List revision history for a page's OCR or translation content.
 *
 * Metered reader (#4357): a named tenant's reading room is exempt only for
 * ITS OWN pages. Any other page (and every page under 'default', the main
 * library) is gated like the global route, so a tenant slug in the URL is not
 * a way round the free sample.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenant: string; id: string }> }
) {
  try {
    const { tenant, id } = await params;
    
    // Resolve tenant slug to UUID (for validation)
    const tenantId = await resolveTenantId(tenant);
    if (!tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    
    const { searchParams } = new URL(request.url);
    const field = searchParams.get('field') as 'ocr' | 'translation' | null;
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    if (!field || (field !== 'ocr' && field !== 'translation')) {
      return NextResponse.json(
        { error: 'field parameter required (ocr or translation)' },
        { status: 400 }
      );
    }

    const db = await getDb();
    const page = await db.collection('pages').findOne(
      { id },
      { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, seo_indexable: 1, tenantId: 1 } },
    );
    if (page) {
      const inThisRoom = tenant !== 'default' && (
        page.tenantId === tenantId
        || (await findUntaggedPagesOfTenantBooks(db, [id], tenantId, { _id: 0, id: 1 })).length > 0
      );
      const gate = await pageGateForRequest(db, request, page, { exempt: inThisRoom });
      if (gate) return meteredSignInResponse(gate);
    }

    const result = await getRevisions(id, field, { limit, offset });

    return NextResponse.json({
      page_id: id,
      field,
      revisions: result.revisions,
      total: result.total,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Error fetching revisions:', error);
    return NextResponse.json({ error: 'Failed to fetch revisions' }, { status: 500 });
  }
}
