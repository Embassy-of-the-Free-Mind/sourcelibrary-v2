import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const preferredRegion = 'fra1';

/**
 * POST /api/bookshelf/[bookId]/remove
 *
 * Remove a book from the visitor's bookshelf.
 * Uses POST instead of DELETE (DELETE is globally blocked).
 * Header: X-Visitor-ID
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ bookId: string }> }
) {
  try {
    const visitorId = _request.headers.get('x-visitor-id');
    if (!visitorId) {
      return NextResponse.json({ error: 'X-Visitor-ID header required' }, { status: 400 });
    }

    const { bookId } = await params;
    const db = await getDb();

    const result = await db.collection('bookshelves').deleteOne({
      visitor_id: visitorId,
      book_id: bookId,
    });

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Remove from bookshelf error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to remove from bookshelf' },
      { status: 500 }
    );
  }
}
