import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { withAuth } from '@/lib/auth-helpers';
import { computeQualityFlags } from '@/lib/kdp-scoring';

/**
 * GET /api/admin/kdp/publications/[id] — Get single publication with book join + translation samples
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
      { projection: { id: 1, title: 1, display_title: 1, author: 1, language: 1, published: 1, slug: 1, thumbnail_blob: 1, thumbnail: 1, pages_count: 1 } }
    );

    // Fetch 3 translation samples: beginning, middle, end
    let translation_samples: Array<{ page_number: number; text: string; char_count: number }> = [];
    if (book) {
      const pagesCount = (book.pages_count as number) || 0;
      if (pagesCount > 0) {
        const samplePositions = [
          Math.max(1, Math.floor(pagesCount * 0.1)),
          Math.floor(pagesCount * 0.5),
          Math.floor(pagesCount * 0.9),
        ];
        const samplePages = await db.collection('pages').find(
          {
            book_id: publication.book_id,
            page_number: { $in: samplePositions },
            'translation.data': { $exists: true, $ne: '' },
          },
          { projection: { page_number: 1, 'translation.data': 1 } }
        ).toArray();

        translation_samples = samplePages.map(p => ({
          page_number: p.page_number as number,
          text: ((p.translation as { data: string }).data || '').slice(0, 500),
          char_count: ((p.translation as { data: string }).data || '').length,
        }));
      }
    }

    return NextResponse.json({
      publication: { ...publication, _id: undefined },
      book: book ? { ...book, _id: undefined } : null,
      translation_samples,
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

    const allowedFields = ['status', 'asin', 'kindle_url', 'goodreads_url', 'notes', 'kdp_metadata', 'cover_image_url', 'quality_flags'];
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

    // Refresh quality flags when transitioning to 'review'
    if (body.status === 'review') {
      const publication = await db.collection('kdp_publications').findOne({ id });
      if (publication) {
        const book = await db.collection('books').findOne(
          { id: publication.book_id },
          { projection: { quality_score: 1, pages_count: 1, reading_summary: 1, index: 1, chapters: 1, thumbnail: 1, thumbnail_blob: 1 } }
        );
        if (book) {
          update.quality_flags = await computeQualityFlags(
            db,
            publication.book_id as string,
            book as Parameters<typeof computeQualityFlags>[2],
          );
        }
      }
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
