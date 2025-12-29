import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * GET /api/books/audit-splits
 *
 * Find books that haven't been checked for split needs.
 * Returns list of books that need checking.
 *
 * Query params:
 *   - limit: Max books to return (default 50)
 *   - includeChecked: Include books already checked (default false)
 *
 * POST /api/books/audit-splits
 *
 * Batch check multiple books for split needs.
 * Calls /api/books/[id]/check-needs-split for each.
 *
 * Body:
 *   - bookIds?: string[] - Specific books to check (or omit to check unchecked books)
 *   - limit?: number - Max books to check (default 10)
 *   - dryRun?: boolean - Don't update books
 */

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const includeChecked = searchParams.get('includeChecked') === 'true';

    const db = await getDb();

    // Find books without split_check
    const query: Record<string, unknown> = {};

    if (!includeChecked) {
      query['split_check'] = { $exists: false };
    }

    // Exclude books that already have split pages
    const booksWithSplits = await db.collection('pages').distinct('book_id', {
      crop: { $exists: true }
    });

    if (booksWithSplits.length > 0) {
      query['id'] = { $nin: booksWithSplits };
    }

    const books = await db.collection('books')
      .find(query)
      .project({
        id: 1,
        title: 1,
        pages_count: 1,
        needs_splitting: 1,
        split_check: 1,
        ia_identifier: 1
      })
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray();

    // Get summary stats
    const totalBooks = await db.collection('books').countDocuments();
    const checkedBooks = await db.collection('books').countDocuments({
      'split_check': { $exists: true }
    });
    const needsSplitting = await db.collection('books').countDocuments({
      needs_splitting: true
    });
    const alreadySplit = booksWithSplits.length;

    return NextResponse.json({
      summary: {
        totalBooks,
        checkedBooks,
        needsSplitting,
        alreadySplit,
        unchecked: totalBooks - checkedBooks - alreadySplit
      },
      books: books.map(b => ({
        id: b.id,
        title: b.title,
        pages: b.pages_count,
        ia_identifier: b.ia_identifier,
        needs_splitting: b.needs_splitting,
        checked: !!b.split_check
      })),
      count: books.length
    });

  } catch (error) {
    console.error('Error auditing splits:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Audit failed' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      bookIds,
      limit = 10,
      dryRun = false
    } = body;

    const db = await getDb();
    const baseUrl = request.nextUrl.origin;

    // Get books to check
    let booksToCheck: Array<{ id: string; title: string }>;

    if (bookIds && Array.isArray(bookIds) && bookIds.length > 0) {
      // Check specific books
      const books = await db.collection('books')
        .find({ id: { $in: bookIds } })
        .project({ id: 1, title: 1 })
        .toArray();
      booksToCheck = books.map(b => ({ id: b.id as string, title: b.title as string }));
    } else {
      // Find unchecked books (no split_check and no existing splits)
      const booksWithSplits = await db.collection('pages').distinct('book_id', {
        crop: { $exists: true }
      });

      const query: Record<string, unknown> = {
        'split_check': { $exists: false }
      };

      if (booksWithSplits.length > 0) {
        query['id'] = { $nin: booksWithSplits };
      }

      const books = await db.collection('books')
        .find(query)
        .project({ id: 1, title: 1 })
        .sort({ created_at: -1 })
        .limit(limit)
        .toArray();

      booksToCheck = books.map(b => ({ id: b.id as string, title: b.title as string }));
    }

    if (booksToCheck.length === 0) {
      return NextResponse.json({
        message: 'No books to check',
        checked: 0,
        results: []
      });
    }

    // Check each book
    const results: Array<{
      bookId: string;
      title: string;
      needs_splitting: boolean | null;
      confidence: string;
      error?: string;
    }> = [];

    for (const book of booksToCheck) {
      try {
        const checkUrl = `${baseUrl}/api/books/${book.id}/check-needs-split?dryRun=${dryRun}`;
        const response = await fetch(checkUrl);
        const result = await response.json();

        results.push({
          bookId: book.id,
          title: book.title,
          needs_splitting: result.needs_splitting,
          confidence: result.confidence || 'unknown',
          error: result.error
        });
      } catch (error) {
        results.push({
          bookId: book.id,
          title: book.title,
          needs_splitting: null,
          confidence: 'error',
          error: error instanceof Error ? error.message : 'Check failed'
        });
      }
    }

    // Summary
    const needsSplit = results.filter(r => r.needs_splitting === true).length;
    const noSplit = results.filter(r => r.needs_splitting === false).length;
    const ambiguous = results.filter(r => r.needs_splitting === null).length;

    return NextResponse.json({
      checked: results.length,
      dryRun,
      summary: {
        needsSplitting: needsSplit,
        noSplitNeeded: noSplit,
        ambiguous
      },
      results
    });

  } catch (error) {
    console.error('Error batch checking splits:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Batch check failed' },
      { status: 500 }
    );
  }
}
