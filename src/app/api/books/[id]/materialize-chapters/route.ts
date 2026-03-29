import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { materializeChapterTexts } from '@/lib/chapter-text';
import { withAuth } from '@/lib/auth-helpers';

export const maxDuration = 60;

/**
 * POST /api/books/[id]/materialize-chapters
 *
 * Concatenates page text into chapter-sized chunks and stores them
 * in the `chapter_texts` collection. Requires chapters to be extracted first.
 */
export const POST = withAuth(async (request, session, context) => {
  try {
    const { id } = await context.params;
    const db = await getDb();

    const book = await db.collection('books').findOne(
      { id },
      { projection: { chapters: 1, title: 1 } },
    );
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }
    if (!book.chapters?.length) {
      return NextResponse.json({ error: 'No chapters extracted yet. Run extract-chapters first.' }, { status: 400 });
    }

    const result = await materializeChapterTexts(db, id);

    return NextResponse.json({
      success: true,
      book_id: id,
      title: book.title,
      ...result,
    });
  } catch (error) {
    console.error('Error materializing chapters:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to materialize chapters' },
      { status: 500 },
    );
  }
});
