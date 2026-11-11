import { NextRequest, NextResponse } from 'next/server';
import { getRevision } from '@/lib/page-revisions';
import { getDb } from '@/lib/mongodb';
import { pageGateForRequest, meteredSignInResponse } from '@/lib/metered-gate';

/**
 * GET /api/pages/[id]/revisions/[revisionId]
 *
 * Get a single revision by ID.
 *
 * A revision is a page's full text, so it follows the page's metered-reader
 * gate (#4357). The page is the one the revision names, not the URL's [id]:
 * the URL id is never checked against it, so it cannot be trusted to.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; revisionId: string }> }
) {
  try {
    const { revisionId } = await params;

    const revision = await getRevision(revisionId);
    if (!revision) {
      return NextResponse.json({ error: 'Revision not found' }, { status: 404 });
    }

    const pageId = (revision as unknown as { page_id?: string }).page_id;
    if (pageId) {
      const db = await getDb();
      const page = await db.collection('pages').findOne(
        { id: pageId },
        { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, seo_indexable: 1 } },
      );
      if (page) {
        const gate = await pageGateForRequest(db, request, page);
        if (gate) return meteredSignInResponse(gate);
      }
    }

    return NextResponse.json(revision);
  } catch (error) {
    console.error('Error fetching revision:', error);
    return NextResponse.json({ error: 'Failed to fetch revision' }, { status: 500 });
  }
}
