import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { findTenantBookByIdOrSlug } from '@/lib/tenant-book-lookup';

// Was previously a page.tsx calling permanentRedirect(). Under Next 16
// streaming/RSC, that emits a 200 response with a NEXT_REDIRECT marker in
// the body — fine for browsers but invisible to crawlers, which is why
// Google saw "Soft 404" / "Page with redirect" for tens of thousands of
// these URLs. A route handler returns a real HTTP 308.

interface RouteContext {
  params: Promise<{ tenant: string; id: string; num: string }>;
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { tenant, id, num } = await params;
  const pageNumber = parseInt(num, 10);

  if (isNaN(pageNumber)) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const db = await getReadDb();

  const result = await findTenantBookByIdOrSlug(db, tenant, id, { id: 1, slug: 1 });
  if (!result) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const bookId = (result.book.id || result.book._id?.toString()) as string;
  const bookSlug = (result.book.slug || bookId) as string;

  const page = await db.collection('pages').findOne(
    { book_id: bookId, page_number: pageNumber },
    { projection: { id: 1 } }
  );

  if (!page) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const pageId = page.id || page._id?.toString();
  const destination = new URL(`/book/${bookSlug}/page/${pageId}`, request.url);
  return NextResponse.redirect(destination, 308);
}
