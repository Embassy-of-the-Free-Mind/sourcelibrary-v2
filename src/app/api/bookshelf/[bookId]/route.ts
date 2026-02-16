import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const preferredRegion = 'fra1';

/**
 * PATCH /api/bookshelf/[bookId]
 *
 * Update bookshelf entry status or reading progress.
 * Header: X-Visitor-ID
 * Body: { status?, last_read_page_id?, last_read_page_number? }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ bookId: string }> }
) {
  try {
    const visitorId = request.headers.get('x-visitor-id');
    if (!visitorId) {
      return NextResponse.json({ error: 'X-Visitor-ID header required' }, { status: 400 });
    }

    const { bookId } = await params;
    const body = await request.json();
    const { status, last_read_page_id, last_read_page_number } = body;

    const db = await getDb();
    const update: Record<string, unknown> = { updated_at: new Date() };

    if (status) {
      const validStatuses = ['want_to_read', 'reading', 'completed'];
      if (!validStatuses.includes(status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      }
      update.status = status;
    }

    if (last_read_page_id !== undefined) {
      update.last_read_page_id = last_read_page_id;
      update.last_read_page_number = last_read_page_number;
      update.last_read_at = new Date();
    }

    const result = await db.collection('bookshelves').updateOne(
      { visitor_id: visitorId, book_id: bookId },
      { $set: update }
    );

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }

    // Auto-transition: want_to_read -> reading when page is read
    if (last_read_page_id && !status) {
      await db.collection('bookshelves').updateOne(
        { visitor_id: visitorId, book_id: bookId, status: 'want_to_read' },
        { $set: { status: 'reading' } }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Update bookshelf error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update bookshelf' },
      { status: 500 }
    );
  }
}
