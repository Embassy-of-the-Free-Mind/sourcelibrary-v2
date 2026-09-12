import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import { getTenantContextFromRequest } from '@/lib/tenant-context';
import { resolvePageByNumber } from '@/lib/page-number-resolve';

/**
 * `/book/<id>/page-number/<n>` → the reader for that printed page.
 *
 * Shared by the English route and its localized twins: `prefix` is the locale
 * segment ('' or '/es') the redirect must PRESERVE. A chapter link that dropped
 * the prefix here would silently bounce a Spanish reader back to the English
 * reader, which is the whole failure #4082 exists to fix.
 */
export async function pageNumberRedirect(
  request: NextRequest,
  params: { id: string; num: string },
  prefix = '',
): Promise<NextResponse> {
  const pageNumber = parseInt(params.num, 10);

  if (isNaN(pageNumber)) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const db = await getReadDb();
  const ctx = getTenantContextFromRequest(request);

  const result = await findBookByIdOrSlug(db, params.id, { id: 1, slug: 1 }, ctx.id ?? undefined);
  if (!result) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const bookId = (result.book.id || result.book._id?.toString()) as string;
  const bookSlug = (result.book.slug || bookId) as string;

  // Resolve with a nearest-page fallback so a chapter whose printed page
  // number doesn't land on an exact pages.page_number value still lands the
  // reader on the closest page instead of a hard 404. Only 404s when the book
  // has no pages at all.
  const page = await resolvePageByNumber(db, bookId, pageNumber);

  if (!page) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const pageId = page.id || page._id?.toString();
  const destination = new URL(`${prefix}/book/${bookSlug}/page/${pageId}`, request.url);
  // Preserve the incoming query string (e.g. ?highlight=, ?v=) so search-result
  // links that land here still highlight/pin on the resolved page reader.
  destination.search = request.nextUrl.search;
  return NextResponse.redirect(destination, 308);
}
