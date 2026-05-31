import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import { getTenantContextFromRequest } from '@/lib/tenant-context';
import { resolvePageByNumber } from '@/lib/page-number-resolve';

interface RouteContext {
  params: Promise<{ id: string; num: string }>;
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { id, num } = await params;
  const pageNumber = parseInt(num, 10);

  if (isNaN(pageNumber)) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const db = await getReadDb();
  const ctx = getTenantContextFromRequest(request);

  const result = await findBookByIdOrSlug(db, id, { id: 1, slug: 1 }, ctx.id ?? undefined);
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
  const destination = new URL(`/book/${bookSlug}/page/${pageId}`, request.url);
  return NextResponse.redirect(destination, 308);
}
