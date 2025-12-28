import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * POST /api/admin/backfill-translation-dates
 *
 * Backfills last_translation_at for all books based on their pages' translation timestamps.
 * This is a one-time migration for existing data.
 */
export async function POST(request: NextRequest) {
  try {
    const { dryRun = true } = await request.json().catch(() => ({ dryRun: true }));

    const db = await getDb();

    // Get all books
    const books = await db.collection('books').find({}).toArray();

    const results: Array<{
      bookId: string;
      title: string;
      lastTranslationAt: string | null;
      pagesWithTranslation: number;
    }> = [];

    let updatedCount = 0;

    for (const book of books) {
      // Find the most recently translated page for this book
      const latestTranslatedPage = await db.collection('pages')
        .find({
          book_id: book.id,
          'translation.data': { $exists: true, $nin: [null, ''] }
        })
        .sort({ 'translation.updated_at': -1 })
        .limit(1)
        .toArray();

      const pagesWithTranslation = await db.collection('pages').countDocuments({
        book_id: book.id,
        'translation.data': { $exists: true, $nin: [null, ''] }
      });

      let lastTranslationAt: Date | null = null;

      if (latestTranslatedPage.length > 0) {
        const pageTranslation = latestTranslatedPage[0].translation;
        if (pageTranslation?.updated_at) {
          lastTranslationAt = new Date(pageTranslation.updated_at);
        }
      }

      results.push({
        bookId: book.id,
        title: book.title,
        lastTranslationAt: lastTranslationAt?.toISOString() || null,
        pagesWithTranslation
      });

      // Update the book if we found a translation date and not in dry run
      if (!dryRun && lastTranslationAt) {
        await db.collection('books').updateOne(
          { id: book.id },
          { $set: { last_translation_at: lastTranslationAt } }
        );
        updatedCount++;
      }
    }

    // Sort results by last translation date (most recent first)
    results.sort((a, b) => {
      if (!a.lastTranslationAt) return 1;
      if (!b.lastTranslationAt) return -1;
      return new Date(b.lastTranslationAt).getTime() - new Date(a.lastTranslationAt).getTime();
    });

    return NextResponse.json({
      success: true,
      dryRun,
      totalBooks: books.length,
      booksWithTranslations: results.filter(r => r.lastTranslationAt).length,
      booksUpdated: updatedCount,
      results: results.slice(0, 50), // Return first 50 for preview
    });

  } catch (error) {
    console.error('Backfill error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Backfill failed' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/backfill-translation-dates
 *
 * Preview what would be backfilled (dry run)
 */
export async function GET() {
  const db = await getDb();

  // Count books with and without last_translation_at
  const totalBooks = await db.collection('books').countDocuments();
  const booksWithDate = await db.collection('books').countDocuments({
    last_translation_at: { $exists: true, $ne: null }
  });
  const booksNeedingBackfill = await db.collection('books').countDocuments({
    $or: [
      { last_translation_at: { $exists: false } },
      { last_translation_at: null }
    ]
  });

  return NextResponse.json({
    totalBooks,
    booksWithDate,
    booksNeedingBackfill,
    message: 'POST with { "dryRun": false } to apply backfill'
  });
}
