export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { updateBookAfterUpload } from '@/lib/uploads/utils';
import { withAuth } from '@/lib/auth-helpers';

/**
 * Update book metadata (thumbnail and page count)
 *
 * POST /api/upload/update-book
 * Body: {
 *   bookId: string;
 * }
 *
 * This endpoint recalculates the page count from the database
 * and updates the book's thumbnail to the first page if not already set.
 *
 * Can be called explicitly after batch uploads or by other scripts.
 *
 * Auth: `editor` or above, or a `Bearer $CRON_SECRET` token for pipeline
 * scripts. It writes `pages_count`, which feeds the canonical public filter
 * (`visible: true && pages_count > 0`), so an unauthenticated caller could flip
 * a book's visibility on every public surface.
 *
 * Example:
 * ```bash
 * curl -X POST http://localhost:3000/api/upload/update-book \
 *   -H "Content-Type: application/json" \
 *   -H "Authorization: Bearer $CRON_SECRET" \
 *   -d '{ "bookId": "book-123" }'
 * ```
 */
export const POST = withAuth(async (request: NextRequest) => {
  try {
    const body = await request.json();
    const { bookId } = body;

    if (!bookId) {
      return NextResponse.json(
        { error: 'Book ID is required...' },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Verify book exists
    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json(
        { error: 'Book not found!' },
        { status: 404 }
      );
    }

    // Update book metadata
    await updateBookAfterUpload(db, bookId);

    // Get updated book
    const updatedBook = await db.collection('books').findOne({ id: bookId });

    return NextResponse.json({
      success: true,
      book: {
        id: updatedBook?.id,
        pages_count: updatedBook?.pages_count,
        thumbnail: updatedBook?.thumbnail
      }
    });
  } catch (error) {
    console.error('Update book error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Update failed' },
      { status: 500 }
    );
  }
}, { minRole: 'editor' });
