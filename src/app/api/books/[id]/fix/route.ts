import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

/**
 * Fix a book that was imported without proper id fields
 * POST /api/books/[id]/fix
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const db = await getDb();
    const booksCollection = db.collection('books');
    const pagesCollection = db.collection('pages');

    // Find book by id or _id
    let book = await booksCollection.findOne({ id });
    if (!book) {
      try {
        if (ObjectId.isValid(id)) {
          book = await booksCollection.findOne({ _id: new ObjectId(id) });
        }
      } catch {
        // Invalid ObjectId
      }
    }

    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const bookObjectId = book._id;
    const bookIdStr = book.id || bookObjectId.toString();

    // Fix book: ensure it has an id field
    if (!book.id) {
      await booksCollection.updateOne(
        { _id: bookObjectId },
        { $set: { id: bookObjectId.toString() } }
      );
      console.log(`Fixed book id: ${bookObjectId.toString()}`);
    }

    // Find pages - try both id formats
    let pages = await pagesCollection.find({ book_id: bookIdStr }).toArray();
    if (pages.length === 0) {
      pages = await pagesCollection.find({ book_id: bookObjectId.toString() }).toArray();
    }
    if (pages.length === 0) {
      // Try finding by ObjectId reference
      pages = await pagesCollection.find({ book_id: bookObjectId }).toArray();
    }

    // Fix pages: ensure each has an id field and correct book_id
    let fixedCount = 0;
    for (const page of pages) {
      const updates: Record<string, unknown> = {};

      if (!page.id) {
        updates.id = page._id.toString();
      }

      // Ensure book_id is the string format
      if (page.book_id !== bookIdStr && page.book_id?.toString() !== bookIdStr) {
        updates.book_id = bookIdStr;
      }

      if (Object.keys(updates).length > 0) {
        await pagesCollection.updateOne(
          { _id: page._id },
          { $set: updates }
        );
        fixedCount++;
      }
    }

    // Update thumbnail if missing
    if (!book.thumbnail && pages.length > 0) {
      const firstPage = pages[0];
      if (firstPage.photo) {
        await booksCollection.updateOne(
          { _id: bookObjectId },
          { $set: { thumbnail: firstPage.photo } }
        );
      }
    }

    return NextResponse.json({
      success: true,
      bookId: bookIdStr,
      pagesFound: pages.length,
      pagesFixed: fixedCount,
      message: `Fixed book and ${fixedCount} pages`
    });

  } catch (error) {
    console.error('Error fixing book:', error);
    return NextResponse.json(
      { error: 'Failed to fix book', details: String(error) },
      { status: 500 }
    );
  }
}
