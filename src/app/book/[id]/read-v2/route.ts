import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import { getTenantContextFromRequest } from '@/lib/tenant-context';
import { resolvePageByNumber } from '@/lib/page-number-resolve';

/**
 * Open a book in the v2c reader preview without knowing a page id.
 *
 * The preview route is /book/<id>/page/<pageId>/v2c, which is fine to link to
 * from inside the reader but useless from anywhere that only knows the book —
 * a browse grid, a search result, a pasted slug. This resolves a page and
 * redirects, so `/book/<slug>/read-v2` is a linkable entry point.
 *
 * Same shape as page-number/[num]: nearest-page fallback via
 * resolvePageByNumber, so a book whose first page_number isn't 1 still lands
 * somewhere real instead of 404ing.
 */
interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  // ?p=N opens at a printed page number; without it, the start of the book.
  const requested = parseInt(request.nextUrl.searchParams.get('p') || '', 10);
  const pageNumber = Number.isNaN(requested) ? 1 : requested;

  const db = await getReadDb();
  const ctx = getTenantContextFromRequest(request);

  const result = await findBookByIdOrSlug(db, id, { id: 1, slug: 1 }, ctx.id ?? undefined);
  if (!result) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const bookId = (result.book.id || result.book._id?.toString()) as string;
  const bookSlug = (result.book.slug || bookId) as string;

  const page = await resolvePageByNumber(db, bookId, pageNumber);
  if (!page) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const pageId = page.id || page._id?.toString();
  const destination = new URL(`/book/${bookSlug}/page/${pageId}/v2c`, request.url);
  return NextResponse.redirect(destination, 307);
}
