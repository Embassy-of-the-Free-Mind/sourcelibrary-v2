import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAuth } from '@/lib/auth-helpers';

/**
 * List deleted books available for restoration.
 *
 * GET /api/books/deleted?limit=100&offset=0&ia_identifier=X
 */
export const GET = withAuth(async (request, session) => {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0);
    const iaIdentifier = searchParams.get('ia_identifier');

    const db = await getDb();
    const filter: Record<string, unknown> = {};
    if (iaIdentifier) filter.ia_identifier = iaIdentifier;

    const [deletedBooks, total] = await Promise.all([
      db.collection('deleted_books')
        .find(filter)
        .project({
          id: 1,
          title: 1,
          author: 1,
          language: 1,
          ia_identifier: 1,
          deleted_at: 1,
          pages: 1
        })
        .sort({ deleted_at: -1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      db.collection('deleted_books').countDocuments(filter),
    ]);

    return NextResponse.json({
      total,
      offset,
      limit,
      count: deletedBooks.length,
      books: deletedBooks.map(book => ({
        id: book.id,
        title: book.title,
        author: book.author,
        language: book.language,
        ia_identifier: book.ia_identifier,
        deleted_at: book.deleted_at,
        pages_count: book.pages?.length || 0
      }))
    });
  } catch (error) {
    console.error('Error listing deleted books:', error);
    return NextResponse.json({ error: 'Failed to list deleted books' }, { status: 500 });
  }
});
