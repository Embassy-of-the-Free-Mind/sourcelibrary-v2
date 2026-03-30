import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';
import { Book } from '@/lib/types';
import { withAuth } from '@/lib/auth-helpers';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0);

    const db = await getDb();

    // pages_count is already cached on each book by the sync-page-counts cron.
    // NEVER $lookup to the pages collection (9.5M docs) on a hot path.
    const books = await db.collection('books')
      .find(
        { hidden: { $ne: true } },
        {
          projection: {
            _id: 0, id: 1, title: 1, display_title: 1, author: 1, language: 1,
            published: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1,
            status: 1, slug: 1, thumbnail: 1, thumbnail_blob: 1, created_at: 1,
            ia_identifier: 1, image_source: 1, collections: 1,
          },
          maxTimeMS: 8000,
        },
      )
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    return NextResponse.json(books, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    console.error('Error fetching books:', error);
    return NextResponse.json({ error: 'Failed to fetch books' }, { status: 500 });
  }
}

// Create a new book
export const POST = withAuth(async (request, session) => {
  try {
    const body = await request.json();
    const {
      title,
      display_title,
      author,
      language,
      published,
      publisher,
      place_of_publication,
      printer,
      ia_identifier,
      image_source
    } = body;

    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    const db = await getDb();
    const bookId = new ObjectId().toHexString();

    const book: Book = {
      id: bookId,
      tenant_id: 'default',
      title,
      display_title: display_title || null,
      author: author || 'Unknown',
      language: language || 'Unknown',
      published: published || 'Unknown',
      publisher: publisher || null,
      place_published: place_of_publication || null,      
      ia_identifier: ia_identifier || null,
      image_source: image_source || null,      
      pages_count: 0,
      status: 'draft',
      created_at: new Date(),
      updated_at: new Date(),
    };

    await db.collection('books').insertOne(book);

    return NextResponse.json(book, { status: 201 });
  } catch (error) {
    console.error('Error creating book:', error);
    return NextResponse.json({ error: 'Failed to create book' }, { status: 500 });
  }
});
