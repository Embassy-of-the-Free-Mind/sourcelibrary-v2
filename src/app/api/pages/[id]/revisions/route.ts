import { NextRequest, NextResponse } from 'next/server';
import { getRevisions } from '@/lib/page-revisions';
import { getDb } from '@/lib/mongodb';
import { pageGateForRequest, meteredSignInResponse } from '@/lib/metered-gate';

/**
 * GET /api/pages/[id]/revisions?field=ocr&limit=50&offset=0
 *
 * List revision history for a page's OCR or translation content.
 *
 * Every revision carries the full text it replaced, so this is a page-text
 * door like /api/pages/[id]: past the metered reader's free sample an
 * anonymous caller gets the sign-in 401 (#4357). The [tenant] twin is
 * exempt, as reading rooms are everywhere.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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
      { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, seo_indexable: 1 } },
    );
    if (page) {
      const gate = await pageGateForRequest(db, request, page);
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
