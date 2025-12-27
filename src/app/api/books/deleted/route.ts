import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * List all deleted books available for restoration
 *
 * GET /api/books/deleted
 */
export async function GET() {
  try {
    const db = await getDb();

    const deletedBooks = await db.collection('deleted_books')
      .find({})
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
      .toArray();

    return NextResponse.json({
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
}
