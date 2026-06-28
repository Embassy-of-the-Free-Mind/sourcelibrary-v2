import { NextRequest, NextResponse } from 'next/server';
import { GET as quoteGET } from '@/app/api/books/[id]/quote/route';

/**
 * GET /api/verify?book_id=<id>&page=<n>
 *
 * A stable, flat, documented alias of the per-page quote endpoint, for
 * web-based research agents whose fetcher only allows URLs of a known shape.
 * It returns the SAME gated, wrapper-stripped verbatim text + full citation
 * block as /api/books/[id]/quote — by re-dispatching to that handler, so the
 * security gate (isBookReadable / hidden + in-copyright refusal), editorial
 * wrapper stripping, bot gating, and rate-limit budget all live in ONE place
 * and cannot drift between the two routes (#2822).
 *
 * Passthrough query params (read by the quote handler from the same request
 * URL): page (required, default 1), include_original, include_context.
 */
export const GET = async (request: NextRequest): Promise<Response> => {
  const bookId = new URL(request.url).searchParams.get('book_id');
  if (!bookId) {
    return NextResponse.json(
      {
        error: 'book_id is required. Usage: /api/verify?book_id=<id>&page=<n>',
        docs: 'https://sourcelibrary.org/developers',
      },
      { status: 400 },
    );
  }
  // Re-dispatch to the quote handler — same request (so page/include_* and the
  // auth/bot/budget gating all apply), with the book id supplied as the route param.
  return quoteGET(request, { params: Promise.resolve({ id: bookId }) });
};
