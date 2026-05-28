import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import { getTenantContextFromRequest } from '@/lib/tenant-context';

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
