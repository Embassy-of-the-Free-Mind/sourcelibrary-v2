import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { scoreBookAlignment } from '@/lib/semantic-alignment';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/books/[id]/semantic-alignment — Return current alignment scores
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const db = await getDb();

    // Book-level summary
    const book = await db.collection('books').findOne(
      { id },
      { projection: { semantic_alignment: 1, title: 1, display_title: 1 } },
    );

    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Per-page scores
    const pages = await db.collection('pages').find(
      { book_id: id, 'semantic_alignment.score': { $exists: true } },
      { projection: { id: 1, page_number: 1, 'semantic_alignment': 1, 'ocr.language': 1 } },
    ).sort({ page_number: 1 }).toArray();

    return NextResponse.json({
      book_id: id,
      title: book.display_title || book.title,
      summary: book.semantic_alignment ?? null,
      pages: pages.map(p => ({
        page_id: p.id,
        page_number: p.page_number,
        language: p.ocr?.language,
        score: p.semantic_alignment?.score,
        scored_at: p.semantic_alignment?.scored_at,
      })),
    });
  } catch (error) {
    console.error('Error fetching semantic alignment:', error);
    return NextResponse.json({ error: 'Failed to fetch alignment scores' }, { status: 500 });
  }
}

/**
 * POST /api/books/[id]/semantic-alignment — Score/rescore alignment
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const db = await getDb();

    // Verify book exists
    const book = await db.collection('books').findOne({ id }, { projection: { id: 1 } });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const result = await scoreBookAlignment(db, id);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      book_id: id,
      pages_scored: result.pagesScored,
      pages_flagged: result.pagesFlagged,
      mean_alignment: result.meanAlignment,
    });
  } catch (error) {
    console.error('Error scoring semantic alignment:', error);
    return NextResponse.json({ error: 'Failed to score alignment' }, { status: 500 });
  }
}
