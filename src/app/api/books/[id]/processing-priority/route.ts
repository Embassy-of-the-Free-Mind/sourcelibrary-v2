import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { scoreBookPriority } from '@/lib/processing-priority';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/books/[id]/processing-priority — Return current priority score
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const db = await getDb();
    const book = await db.collection('books').findOne(
      { id },
      { projection: { processing_priority: 1, processing_priority_breakdown: 1, title: 1, display_title: 1 } },
    );

    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    return NextResponse.json({
      book_id: id,
      title: book.display_title || book.title,
      processing_priority: book.processing_priority ?? null,
      breakdown: book.processing_priority_breakdown ?? null,
    });
  } catch (error) {
    console.error('Error fetching processing priority:', error);
    return NextResponse.json({ error: 'Failed to fetch processing priority' }, { status: 500 });
  }
}

/**
 * POST /api/books/[id]/processing-priority — Compute/refresh priority score
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const db = await getDb();
    const result = await scoreBookPriority(db, id);

    if (!result) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    return NextResponse.json({
      book_id: id,
      processing_priority: result.score,
      breakdown: result.breakdown,
    });
  } catch (error) {
    console.error('Error scoring book priority:', error);
    return NextResponse.json({ error: 'Failed to score processing priority' }, { status: 500 });
  }
}
