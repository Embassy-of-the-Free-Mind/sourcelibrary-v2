import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { findBookByIdOrSlug } from '@/lib/book-lookup';
import { publicUrl } from '@/lib/public-origin';

/**
 * Resolves /book/{id}?page=N to the reader URL /book/{slug}/page/{pageId}.
 * Called via middleware rewrite so the book page can remain ISR-cacheable
 * (no searchParams dependency).
 */
export async function GET(request: NextRequest) {
  const bookIdOrSlug = request.headers.get('x-redirect-book');
  const pageNum = parseInt(request.headers.get('x-redirect-page') || '', 10);

  if (!bookIdOrSlug) {
    return NextResponse.redirect(publicUrl('/', request), 302);
  }

  const db = await getReadDb();
  const result = await findBookByIdOrSlug(db, bookIdOrSlug, { id: 1, slug: 1 });

  if (!result) {
    return NextResponse.redirect(publicUrl(`/book/${bookIdOrSlug}`, request), 302);
  }

  const bookId = (result.book.id || result.book._id?.toString()) as string;
  const slug = (result.book.slug || bookId) as string;

  if (isNaN(pageNum) || pageNum < 1) {
    return NextResponse.redirect(publicUrl(`/book/${slug}`, request), 302);
  }

  const targetPage = await db.collection('pages').findOne(
    { book_id: bookId, page_number: pageNum },
    { projection: { id: 1 } },
  );

  if (targetPage) {
    const pageId = (targetPage.id || targetPage._id?.toString()) as string;
    return NextResponse.redirect(publicUrl(`/book/${slug}/page/${pageId}`, request), 301);
  }

  // Page number not found — redirect to the book page
  return NextResponse.redirect(publicUrl(`/book/${slug}`, request), 302);
}
