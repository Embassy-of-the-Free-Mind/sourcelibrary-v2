import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = await getDb();

    // Get book
    const book = await db.collection('books').findOne({ id });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Get pages for this book
    const pages = await db.collection('pages')
      .find({ book_id: id })
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

    // Delete all pages for this book
    const pagesResult = await db.collection('pages').deleteMany({ book_id: bookId });

    // Also try deleting with _id reference
    if (pagesResult.deletedCount === 0) {
      await db.collection('pages').deleteMany({ book_id: book._id.toString() });
    }

    // Delete the book
    await db.collection('books').deleteOne({ _id: book._id });

    return NextResponse.json({
      success: true,
      message: `Deleted book and ${pagesResult.deletedCount} pages`,
      bookId
    });
  } catch (error) {
    console.error('Error deleting book:', error);
    return NextResponse.json({ error: 'Failed to delete book' }, { status: 500 });
  }
}
