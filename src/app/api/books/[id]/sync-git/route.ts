import { NextResponse } from 'next/server';
import { syncBookToGitHub } from '@/lib/git-sync';
import { withAuth } from '@/lib/auth-helpers';

/**
 * POST /api/books/[id]/sync-git
 *
 * Manually sync a book's text to the source-library-texts GitHub repo.
 * Creates/updates OCR and translation files with a git commit.
 */
export const POST = withAuth(async (_request, _session, context) => {
  const { id: bookId } = await context.params;

  const result = await syncBookToGitHub(bookId);

  if (result.error && !result.synced) {
    return NextResponse.json(result, { status: result.error === 'No changes detected' ? 200 : 500 });
  }

  return NextResponse.json(result);
});
