import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

// POST /api/books/[id]/pages - Add pages to a book
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const body = await request.json();
    const db = await getDb();

    // Check book exists
    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Support single page or batch
    const pages = Array.isArray(body) ? body : [body];
    const now = new Date();

    // Build all documents upfront
    const docs = pages.map(pageData => {
      const pageId = new ObjectId();
      return {
        _id: pageId,
        id: pageId.toHexString(),
        tenant_id: 'default',
        book_id: bookId,
        page_number: pageData.page_number,
        photo: pageData.photo,
        thumbnail: pageData.thumbnail || pageData.photo,
        photo_original: pageData.photo,
        ocr: {
          language: book.language || 'Unknown',
          model: null,
          data: ''
        },
        translation: {
          language: 'English',
          model: null,
          data: ''
        },
        created_at: now,
        updated_at: now
      };
    });

    // Bulk insert for efficiency
    await db.collection('pages').insertMany(docs);

    return NextResponse.json({
      success: true,
      created: docs.length,
      pages: docs.map(d => ({ id: d.id, page_number: d.page_number }))
    });
  } catch (error) {
    console.error('Error creating pages:', error);
    return NextResponse.json({ error: 'Failed to create pages' }, { status: 500 });
  }
}
