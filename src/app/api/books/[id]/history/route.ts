import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import { assembleBookHistory, BOOK_HISTORY_PROJECTION } from '@/lib/book-history';

/**
 * GET /api/books/[id]/history
 * Returns the provenance timeline for a book. See `src/lib/book-history.ts`
 * for the data sources, schema, and known gaps.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: bookId } = await params;
    const db = await getDb();

    const result = await findBookByIdOrSlug(db, bookId, BOOK_HISTORY_PROJECTION);
    if (!result) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const response = await assembleBookHistory(db, result.book);
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching book history:', error);
    return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 });
  }
}
