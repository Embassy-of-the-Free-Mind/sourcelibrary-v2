import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAuth } from '@/lib/auth-helpers';
import { generateKdpMetadata } from '@/lib/kdp-scoring';
import crypto from 'crypto';

/**
 * GET /api/admin/kdp/publications — List publications with optional status filter
 */
export const GET = withAuth(async (request: NextRequest) => {
  try {
    const db = await getDb();
    const url = new URL(request.url);
    const status = url.searchParams.get('status');

    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;

    const publications = await db.collection('kdp_publications')
      .find(filter)
      .sort({ kdp_score_snapshot: -1 })
      .toArray();

    // Enrich with book data
    const bookIds = publications.map(p => p.book_id);
    const books = await db.collection('books').find(
      { id: { $in: bookIds } },
      { projection: { id: 1, title: 1, display_title: 1, author: 1, thumbnail_blob: 1, thumbnail: 1, slug: 1 } }
    ).toArray();
    const bookMap = new Map(books.map(b => [b.id, b]));

    const results = publications.map(p => {
      const book = bookMap.get(p.book_id);
      return {
        ...p,
        _id: undefined,
        book: book ? {
          title: book.display_title || book.title,
          author: book.author,
          thumbnail: book.thumbnail_blob || book.thumbnail,
          slug: book.slug,
        } : null,
      };
    });

    return NextResponse.json({ publications: results });
  } catch (error) {
    console.error('KDP publications list error:', error);
    return NextResponse.json({ error: 'Failed to fetch publications' }, { status: 500 });
  }
});

/**
 * POST /api/admin/kdp/publications — Create a publication record
 */
export const POST = withAuth(async (request: NextRequest) => {
  try {
    const db = await getDb();
    const body = await request.json();
    const { book_id } = body;

    if (!book_id) {
      return NextResponse.json({ error: 'book_id required' }, { status: 400 });
    }

    // Check for existing publication
    const existing = await db.collection('kdp_publications').findOne({ book_id });
    if (existing) {
      return NextResponse.json({ error: 'Publication already exists for this book', id: existing.id }, { status: 409 });
    }

    // Fetch book data
    const book = await db.collection('books').findOne({ id: book_id });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Generate metadata
    const kdpMetadata = generateKdpMetadata(book as unknown as Parameters<typeof generateKdpMetadata>[0]);

    const publication = {
      id: crypto.randomUUID(),
      book_id,
      status: 'candidate' as const,
      kdp_metadata: kdpMetadata,
      kdp_score_snapshot: book.kdp_score || 0,
      created_at: new Date(),
      updated_at: new Date(),
    };

    await db.collection('kdp_publications').insertOne(publication);

    return NextResponse.json({ publication });
  } catch (error) {
    console.error('KDP publication create error:', error);
    return NextResponse.json({ error: 'Failed to create publication' }, { status: 500 });
  }
});
