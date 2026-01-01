import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * Find and fix books with Google Books poster images
 *
 * GET /api/admin/fix-google-posters
 * Returns list of books with Google posters
 *
 * POST /api/admin/fix-google-posters
 * Body: { book_id?: string, fix_all?: boolean }
 * Fixes specific book or all books with Google posters
 */

export async function GET() {
  try {
    const db = await getDb();

    // Find all books with Google Books thumbnails
    const books = await db.collection('books')
      .find({
        thumbnail: { $regex: 'books\\.google', $options: 'i' }
      })
      .project({ id: 1, title: 1, author: 1, thumbnail: 1 })
      .toArray();

    return NextResponse.json({
      count: books.length,
      books: books.map(b => ({
        id: b.id,
        title: b.title,
        author: b.author,
        thumbnail: b.thumbnail
      }))
    });
  } catch (error) {
    console.error('Error finding Google poster books:', error);
    return NextResponse.json({ error: 'Failed to find books' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { book_id, fix_all } = body as { book_id?: string; fix_all?: boolean };

    const db = await getDb();
    const results: Array<{
    id: string;
    title: string;
    old_thumbnail: string;
    new_thumbnail: string;
    frontispiece_page?: number;
    status: string;
  }> = [];

    // Build query
    const query: Record<string, unknown> = {
      thumbnail: { $regex: 'books\\.google', $options: 'i' }
    };
    if (book_id) {
      query.id = book_id;
    }

    // Find books to fix
    const books = await db.collection('books')
      .find(query)
      .project({ id: 1, title: 1, thumbnail: 1 })
      .toArray();

    if (books.length === 0) {
      return NextResponse.json({
        success: true,
        message: book_id ? 'Book not found or does not have Google poster' : 'No books with Google posters found',
        fixed: 0
      });
    }

    // Only fix one at a time unless fix_all is true
    const booksToFix = fix_all ? books : [books[0]];

    for (const book of booksToFix) {
      // Fetch book's pages
      const fullBook = await db.collection('books').findOne({ id: book.id });
      if (!fullBook) continue;

      // Get pages from the pages collection
      const pages = await db.collection('pages')
        .find({ book_id: book.id })
        .sort({ page_number: 1 })
        .limit(5)
        .toArray();

      if (pages.length === 0) {
        results.push({
          id: book.id,
          title: book.title,
          old_thumbnail: book.thumbnail,
          new_thumbnail: '',
          status: 'error: no pages found'
        });
        continue;
      }

      // Find the best frontispiece - use OCR to identify title page
      let frontispiece = pages[0];

      // If book has title/author, look for the page containing them
      const bookTitle = fullBook.title?.toLowerCase() || '';
      const bookAuthor = fullBook.author?.toLowerCase() || '';

      // Check first 5 pages for the one that looks most like a title page
      for (const page of pages) {
        const ocrText = (page.ocr?.data || '').toLowerCase();

        // Skip blank or minimal pages
        if (ocrText.length < 50) continue;

        // Title page indicators (Latin/English publishing terms)
        const titlePageIndicators = [
          'excudebat', 'typis', 'apud', 'impensis', // Latin printing terms
          'published', 'printed', 'anno', 'mdcc', 'mdccc', 'm.dc', 'm.d.', // Publishing info
          'cum privilegio', 'sumptibus', // Privilege/expense mentions
        ];

        const hasPublishingInfo = titlePageIndicators.some(term => ocrText.includes(term));

        // Check if this page contains the title or author name
        const titleWords = bookTitle.split(/\s+/).filter((w: string) => w.length > 3);
        const authorWords = bookAuthor.split(/\s+/).filter((w: string) => w.length > 3);

        const titleMatch = titleWords.length > 0 &&
          titleWords.filter((w: string) => ocrText.includes(w)).length >= Math.min(2, titleWords.length);
        const authorMatch = authorWords.length > 0 &&
          authorWords.some((w: string) => ocrText.includes(w));

        // This looks like the title page!
        if ((titleMatch || authorMatch) && hasPublishingInfo) {
          frontispiece = page;
          break;
        }

        // Fall back to any page with publishing info
        if (hasPublishingInfo && frontispiece === pages[0]) {
          frontispiece = page;
        }
      }

      const imageUrl = frontispiece.cropped_photo || frontispiece.archived_photo || frontispiece.photo;

      if (!imageUrl) {
        results.push({
          id: book.id,
          title: book.title,
          old_thumbnail: book.thumbnail,
          new_thumbnail: '',
          status: 'error: no image URL found on page 1'
        });
        continue;
      }

      // Create proxied thumbnail URL
      const newThumbnail = `/api/image?url=${encodeURIComponent(imageUrl)}&w=400&q=80`;

      // Update the book
      await db.collection('books').updateOne(
        { id: book.id },
        {
          $set: {
            thumbnail: newThumbnail,
            updated_at: new Date()
          }
        }
      );

      results.push({
        id: book.id,
        title: book.title,
        old_thumbnail: book.thumbnail,
        new_thumbnail: newThumbnail,
        frontispiece_page: frontispiece.page_number,
        status: 'fixed'
      });
    }

    const fixedCount = results.filter(r => r.status === 'fixed').length;

    return NextResponse.json({
      success: true,
      fixed: fixedCount,
      total_with_google_posters: books.length,
      remaining: books.length - fixedCount,
      results
    });
  } catch (error) {
    console.error('Error fixing Google posters:', error);
    return NextResponse.json({ error: 'Failed to fix posters' }, { status: 500 });
  }
}
