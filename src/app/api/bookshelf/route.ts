import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export const preferredRegion = 'fra1';

/**
 * GET /api/bookshelf
 *
 * List all bookshelf entries for a visitor, joined with book data.
 * Requires X-Visitor-ID header or ?visitor_id param.
 */
export async function GET(request: NextRequest) {
  try {
    const visitorId =
      request.headers.get('x-visitor-id') ||
      new URL(request.url).searchParams.get('visitor_id');

    if (!visitorId) {
      return NextResponse.json({ error: 'visitor_id required' }, { status: 400 });
    }

    const db = await getDb();

    const entries = await db
      .collection('bookshelves')
      .aggregate([
        { $match: { visitor_id: visitorId } },
        {
          $lookup: {
            from: 'books',
            localField: 'book_id',
            foreignField: 'id',
            as: 'book',
          },
        },
        { $unwind: { path: '$book', preserveNullAndEmptyArrays: true } },
        { $sort: { updated_at: -1 } },
        {
          $project: {
            _id: 0,
            book_id: 1,
            status: 1,
            last_read_page_id: 1,
            last_read_page_number: 1,
            last_read_at: 1,
            added_at: 1,
            updated_at: 1,
            book: {
              title: { $ifNull: ['$book.display_title', '$book.title'] },
              author: '$book.author',
              year: '$book.year',
              language: '$book.language',
              pages_count: '$book.pages_count',
              pages_translated: '$book.pages_translated',
              pages_ocr: '$book.pages_ocr',
              cover_image: {
                $ifNull: [
                  { $arrayElemAt: ['$book.pages_with_photos', 0] },
                  null,
                ],
              },
            },
          },
        },
      ])
      .toArray();

    // Fetch first page photo for cover
    const bookIds = entries.map((e: any) => e.book_id);
    const coverPages = await db
      .collection('pages')
      .find(
        { book_id: { $in: bookIds }, page_number: 1 },
        { projection: { book_id: 1, photo: 1, archived_photo: 1, cropped_photo: 1 } }
      )
      .toArray();

    const coverMap = new Map<string, string>();
    for (const p of coverPages) {
      coverMap.set(
        p.book_id as string,
        (p.archived_photo || p.cropped_photo || p.photo) as string
      );
    }

    const items = entries.map((e: any) => ({
      ...e,
      book: {
        ...e.book,
        cover_image: coverMap.get(e.book_id) || null,
      },
    }));

    return NextResponse.json({ entries: items, total: items.length });
  } catch (error) {
    console.error('Get bookshelf error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get bookshelf' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/bookshelf
 *
 * Add a book to the visitor's bookshelf.
 * Body: { book_id, status? }
 * Header: X-Visitor-ID
 */
export async function POST(request: NextRequest) {
  try {
    const visitorId = request.headers.get('x-visitor-id');
    if (!visitorId) {
      return NextResponse.json({ error: 'X-Visitor-ID header required' }, { status: 400 });
    }

    const body = await request.json();
    const { book_id, status = 'want_to_read' } = body;

    if (!book_id) {
      return NextResponse.json({ error: 'book_id required' }, { status: 400 });
    }

    const validStatuses = ['want_to_read', 'reading', 'completed'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const db = await getDb();
    const now = new Date();

    await db.collection('bookshelves').updateOne(
      { visitor_id: visitorId, book_id },
      {
        $set: { status, updated_at: now },
        $setOnInsert: {
          visitor_id: visitorId,
          book_id,
          last_read_page_id: null,
          last_read_page_number: null,
          last_read_at: null,
          added_at: now,
        },
      },
      { upsert: true }
    );

    return NextResponse.json({ success: true, status });
  } catch (error) {
    console.error('Add to bookshelf error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to add to bookshelf' },
      { status: 500 }
    );
  }
}
