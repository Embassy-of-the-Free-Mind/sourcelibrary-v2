import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

/**
 * Restore a deleted book from the deleted_books archive
 *
 * POST /api/books/restore/[id]
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();

    // Find in deleted_books collection
    let archivedBook = await db.collection('deleted_books').findOne({ id });
    if (!archivedBook && ObjectId.isValid(id)) {
      archivedBook = await db.collection('deleted_books').findOne({
        $or: [
          { _id: new ObjectId(id) },
          { 'original_id': new ObjectId(id) }
        ]
      });
    }

    if (!archivedBook) {
      return NextResponse.json({
        error: 'Deleted book not found',
        hint: 'Use GET /api/books/deleted to list archived books'
      }, { status: 404 });
    }

    // Extract pages from the archived document
    const { pages, deleted_at, original_id, ...bookData } = archivedBook;

    // Restore book (generate new _id to avoid conflicts)
    const newBookId = new ObjectId();
    await db.collection('books').insertOne({
      ...bookData,
      _id: newBookId,
      restored_at: new Date(),
      restored_from: archivedBook._id
    });

    // Restore pages
    if (pages && pages.length > 0) {
      const restoredPages = pages.map((page: Record<string, unknown>) => ({
        ...page,
        _id: new ObjectId(), // New _id for each page
        restored_at: new Date()
      }));
      await db.collection('pages').insertMany(restoredPages);
    }

    // Remove from deleted_books
    await db.collection('deleted_books').deleteOne({ _id: archivedBook._id });

    return NextResponse.json({
      success: true,
      message: `Restored book "${bookData.title}" with ${pages?.length || 0} pages`,
      bookId: bookData.id,
      pagesRestored: pages?.length || 0
    });
  } catch (error) {
    console.error('Error restoring book:', error);
    return NextResponse.json({ error: 'Failed to restore book' }, { status: 500 });
  }
}

/**
 * List all deleted books available for restoration
 *
 * GET /api/books/restore
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
        deleted_at: 1,
        'pages': { $size: '$pages' }
      })
      .sort({ deleted_at: -1 })
      .toArray();

    return NextResponse.json({
      count: deletedBooks.length,
      books: deletedBooks.map(book => ({
        id: book.id,
        title: book.title,
        author: book.author,
        deleted_at: book.deleted_at,
        pages_count: book.pages || 0
      }))
    });
  } catch (error) {
    console.error('Error listing deleted books:', error);
    return NextResponse.json({ error: 'Failed to list deleted books' }, { status: 500 });
  }
}
