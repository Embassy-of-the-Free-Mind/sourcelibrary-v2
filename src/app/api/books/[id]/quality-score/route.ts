import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { scoreBookQuality } from '@/lib/quality-scoring';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/books/[id]/quality-score — Return current quality score
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const db = await getDb();
    const book = await db.collection('books').findOne(
      { id },
      { projection: { quality_score: 1, quality_assessment: 1, title: 1, display_title: 1 } },
    );

    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    return NextResponse.json({
      book_id: id,
      title: book.display_title || book.title,
      quality_score: book.quality_score ?? null,
      quality_assessment: book.quality_assessment ?? null,
    });
  } catch (error) {
    console.error('Error fetching quality score:', error);
    return NextResponse.json({ error: 'Failed to fetch quality score' }, { status: 500 });
  }
}

/**
 * POST /api/books/[id]/quality-score — Generate/refresh quality score
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const db = await getDb();
    const result = await scoreBookQuality(db, id);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      book_id: id,
      quality_score: result.score,
      assessment: result.assessment,
    });
  } catch (error) {
    console.error('Error scoring book:', error);
    return NextResponse.json({ error: 'Failed to score book' }, { status: 500 });
  }
}
