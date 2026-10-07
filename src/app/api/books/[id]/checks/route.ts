import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import { getBookChecks } from '@/lib/book-checks';
import { withAuth } from '@/lib/auth-helpers';

/**
 * GET /api/books/[id]/checks
 * The book's QA record (#6174): every `book_checks` row, newest first, and the latest per method with the pages
 * whose text has changed since that check read them. An empty `latest` means "not yet checked".
 * Editor and above: rows carry reviewer notes and evidence paths into private results. A public one-line note is
 * a separate, reviewed change.
 */
export const GET = withAuth(
  async (
    _request: NextRequest,
    _session,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await params;
      const db = await getDb();
      const found = await findBookByIdOrSlug(db, id, { id: 1 });
      if (!found) return NextResponse.json({ error: 'Book not found' }, { status: 404 });

      const { book } = found;
      const ids = [...new Set([book.id, String(book._id)].filter(Boolean))] as string[];
      const { latest, history, truncated } = await getBookChecks(db, ids);
      return NextResponse.json({
        book_id: book.id ?? String(book._id),
        checked: history.length > 0,
        latest,
        history,
        ...(truncated ? { truncated: true } : {}),
        methods: 'https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/tree/main/scripts/eval/methods',
      });
    } catch (error) {
      console.error('Error fetching book checks:', error);
      return NextResponse.json({ error: 'Failed to fetch checks' }, { status: 500 });
    }
  },
  { minRole: 'editor' },
);
