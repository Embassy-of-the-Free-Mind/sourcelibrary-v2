import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAuth } from '@/lib/auth-helpers';

/**
 * GET /api/admin/kdp/publications/[id] — Get single publication with book join
 */
export const GET = withAuth(async (request: NextRequest, session, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const db = await getDb();
    const { id } = await params;

    const publication = await db.collection('kdp_publications').findOne({ id });
    if (!publication) {
      return NextResponse.json({ error: 'Publication not found' }, { status: 404 });
    }

    const book = await db.collection('books').findOne(
      { id: publication.book_id },
      { projection: { id: 1, title: 1, display_title: 1, author: 1, language: 1, published: 1, slug: 1, thumbnail_blob: 1, thumbnail: 1 } }
    );

    return NextResponse.json({
      publication: { ...publication, _id: undefined },
      book: book ? { ...book, _id: undefined } : null,
    });
  } catch (error) {
    console.error('KDP publication get error:', error);
    return NextResponse.json({ error: 'Failed to fetch publication' }, { status: 500 });
  }
});

/**
 * PATCH /api/admin/kdp/publications/[id] — Update publication fields
 */
export const PATCH = withAuth(async (request: NextRequest, session, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const db = await getDb();
    const { id } = await params;
    const body = await request.json();

    const allowedFields = ['status', 'asin', 'kindle_url', 'goodreads_url', 'notes', 'kdp_metadata'];
    const update: Record<string, unknown> = { updated_at: new Date() };

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        update[field] = body[field];
      }
    }

    // Set published_at when transitioning to 'live'
    if (body.status === 'live') {
      update.published_at = new Date();
    }

    const result = await db.collection('kdp_publications').findOneAndUpdate(
      { id },
      { $set: update },
      { returnDocument: 'after' }
    );

    if (!result) {
      return NextResponse.json({ error: 'Publication not found' }, { status: 404 });
    }

    return NextResponse.json({ publication: { ...result, _id: undefined } });
  } catch (error) {
    console.error('KDP publication update error:', error);
    return NextResponse.json({ error: 'Failed to update publication' }, { status: 500 });
  }
});
