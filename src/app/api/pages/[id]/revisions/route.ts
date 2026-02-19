import { NextRequest, NextResponse } from 'next/server';
import { getRevisions } from '@/lib/page-revisions';

/**
 * GET /api/pages/[id]/revisions?field=ocr&limit=50&offset=0
 *
 * List revision history for a page's OCR or translation content.
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
