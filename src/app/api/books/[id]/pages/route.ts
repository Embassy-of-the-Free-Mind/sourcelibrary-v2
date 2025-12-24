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
    const created = [];

    for (const pageData of pages) {
      const pageId = new ObjectId();
      const doc = {
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
        created_at: new Date(),
        updated_at: new Date()
      };

      await db.collection('pages').insertOne(doc);
      created.push({ id: doc.id, page_number: doc.page_number });
    }

    return NextResponse.json({
      success: true,
      created: created.length,
      pages: created
    });
  } catch (error) {
    console.error('Error creating pages:', error);
    return NextResponse.json({ error: 'Failed to create pages' }, { status: 500 });
  }
}
