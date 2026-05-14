import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import { resolveTenantId } from '@/lib/tenant-context';
import { assembleBookHistory, BOOK_HISTORY_PROJECTION } from '@/lib/book-history';
import { withAuth } from '@/lib/auth-helpers';

/**
 * GET /api/[tenant]/books/[id]/history
 * Inner circle (editor) and above only — exposes prompt versions, model
 * identities, costs, and admin actions. Same payload as the non-tenant route.
 */
export const GET = withAuth(
  async (
    _request: NextRequest,
    _session,
    { params }: { params: Promise<{ tenant: string; id: string }> },
  ) => {
    try {
      const { tenant, id: bookId } = await params;
      const db = await getDb();
      const tenantId = await resolveTenantId(tenant);
      if (!tenantId) {
        return NextResponse.json({ error: 'Book not found' }, { status: 404 });
      }

      const result = await findBookByIdOrSlug(db, bookId, BOOK_HISTORY_PROJECTION, tenantId);
      if (!result) {
        return NextResponse.json({ error: 'Book not found' }, { status: 404 });
      }

      const response = await assembleBookHistory(db, result.book);
      return NextResponse.json(response);
    } catch (error) {
      console.error('Error fetching book history:', error);
      return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 });
    }
  },
  { minRole: 'editor' },
);
