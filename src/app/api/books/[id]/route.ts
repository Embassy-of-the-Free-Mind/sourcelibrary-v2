import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const includeFull = searchParams.get('full') === 'true';
    const db = await getDb();

    // Get book
    const book = await db.collection('books').findOne({ id });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Get pages for this book
    // By default, exclude large text fields for faster loading
    // Use ?full=true to include OCR/translation/summary data
    const projection = includeFull
      ? {}
      : { 'ocr.data': 0, 'translation.data': 0, 'summary.data': 0 };

    const pages = await db.collection('pages')
      .find({ book_id: id })
      .project(projection)
      .sort({ page_number: 1 })
      .toArray();

    return NextResponse.json({ ...book, pages });
  } catch (error) {
    console.error('Error fetching book:', error);
    return NextResponse.json({ error: 'Failed to fetch book' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const confirmPermanent = searchParams.get('confirm') === 'PERMANENTLY_DELETE';
    const db = await getDb();

    // Find book by id or _id
    let book = await db.collection('books').findOne({ id });
    if (!book && ObjectId.isValid(id)) {
      book = await db.collection('books').findOne({ _id: new ObjectId(id) });
    }

    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const bookId = book.id || book._id.toString();

    // SOFT DELETE by default - archive to deleted_books collection
    if (!confirmPermanent) {
      // Get all pages for archival
      const pages = await db.collection('pages').find({ book_id: bookId }).toArray();

      // Archive book with its pages
      await db.collection('deleted_books').insertOne({
        ...book,
        pages,
        deleted_at: new Date(),
        original_id: book._id
      });

      // Remove from active collections
      await db.collection('pages').deleteMany({ book_id: bookId });
      await db.collection('books').deleteOne({ _id: book._id });

      return NextResponse.json({
        success: true,
        message: `Archived "${book.title}" with ${pages.length} pages`,
        bookId,
        recoverable: true,
        hint: 'POST /api/books/restore/{id} to recover'
      });
    }

    // PERMANENT DELETE - requires ?confirm=PERMANENTLY_DELETE
    // Check if book is in deleted_books and enforce 7-day waiting period
    const archivedBook = await db.collection('deleted_books').findOne({
      $or: [{ id: bookId }, { 'original_id': book._id }]
    });

    if (archivedBook) {
      const deletedAt = new Date(archivedBook.deleted_at);
      const daysSinceDeleted = (Date.now() - deletedAt.getTime()) / (1000 * 60 * 60 * 24);

      if (daysSinceDeleted < 7) {
        return NextResponse.json({
          error: 'Cannot permanently delete yet',
          message: `Book was archived ${daysSinceDeleted.toFixed(1)} days ago. Must wait 7 days before permanent deletion.`,
          deleted_at: archivedBook.deleted_at,
          can_purge_after: new Date(deletedAt.getTime() + 7 * 24 * 60 * 60 * 1000)
        }, { status: 403 });
      }

      // OK to purge - it's been 7+ days
      await db.collection('deleted_books').deleteOne({ _id: archivedBook._id });
      return NextResponse.json({
        success: true,
        message: `PERMANENTLY deleted archived book "${archivedBook.title}"`,
        bookId,
        recoverable: false
      });
    }

    // Book is not archived - permanent delete from active (should be rare)
    const pagesResult = await db.collection('pages').deleteMany({ book_id: bookId });
    await db.collection('books').deleteOne({ _id: book._id });

    return NextResponse.json({
      success: true,
      message: `PERMANENTLY deleted "${book.title}" and ${pagesResult.deletedCount} pages`,
      bookId,
      recoverable: false,
      warning: 'This action cannot be undone'
    });
  } catch (error) {
    console.error('Error deleting book:', error);
    return NextResponse.json({ error: 'Failed to delete book' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const db = await getDb();

    // Find book
    let book = await db.collection('books').findOne({ id });
    if (!book && ObjectId.isValid(id)) {
      book = await db.collection('books').findOne({ _id: new ObjectId(id) });
    }

    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Allowed fields to update
    const allowedFields = [
      'title', 'display_title', 'author', 'language', 'published',
      'thumbnail', 'categories', 'status', 'summary', 'dublin_core',
      // USTC catalog fields
      'ustc_id', 'place_published', 'publisher', 'format',
      // Image source and licensing
      'image_source', 'license', 'doi'
    ];

    const updates: Record<string, unknown> = { updated_at: new Date() };
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    await db.collection('books').updateOne(
      { _id: book._id },
      { $set: updates }
    );

    return NextResponse.json({ success: true, updated: Object.keys(updates) });
  } catch (error) {
    console.error('Error updating book:', error);
    return NextResponse.json({ error: 'Failed to update book' }, { status: 500 });
  }
}
