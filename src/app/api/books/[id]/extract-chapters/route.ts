import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { extractChaptersForBook } from '@/lib/chapter-extraction';
import { withAuth } from '@/lib/auth-helpers';

export const POST = withAuth(async (request, session, context) => {
  try {
    const { id } = await context.params;
    const db = await getDb();

    const result = await extractChaptersForBook(db, id);

    return NextResponse.json({
      success: true,
      chaptersCount: result.chapters.length,
      chapters: result.chapters,
      rawHeadingsCount: result.rawHeadingsCount,
      tocPagesFound: result.tocPagesFound,
      usage: result.usage,
    });
  } catch (error) {
    console.error('Error extracting chapters:', error);
    const message = error instanceof Error ? error.message : 'Failed to extract chapters';
    const status = message === 'Book not found' || message.includes('No pages') ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
});

// GET endpoint to retrieve existing chapters
export const GET = withAuth(async (request, session, context) => {
  try {
    const { id } = await context.params;
    const db = await getDb();

    const book = await db.collection('books').findOne({ id });

    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    return NextResponse.json({
      chapters: book.chapters || [],
      extractedAt: book.chapters_extracted_at,
    });
  } catch (error) {
    console.error('Error getting chapters:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get chapters' },
      { status: 500 }
    );
  }
});
