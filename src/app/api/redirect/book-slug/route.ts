import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { findBookByIdOrSlug } from '@/lib/book-lookup';

/**
 * Resolves /book/{non-slug-id} to /book/{slug} via 301 redirect.
 * Called via proxy rewrite so the book page component never calls redirect(),
 * which would force it into fully-dynamic rendering (no ISR).
 */
export async function GET(request: NextRequest) {
  const bookIdOrSlug = request.nextUrl.searchParams.get('id');

  if (!bookIdOrSlug) {
    return NextResponse.redirect(new URL('/', request.url), 302);
  }

  const db = await getDb();
  const result = await findBookByIdOrSlug(db, bookIdOrSlug, { id: 1, slug: 1 });

  if (!result) {
    // Book not found — let the page handle 404
    return NextResponse.next();
  }

  const slug = (result.book.slug || result.book.id || result.book._id?.toString()) as string;

  // If the lookup matched by slug, no redirect needed — pass through
  if (result.matchedBySlug) {
    return NextResponse.next();
  }

  // Redirect non-slug URL to canonical slug URL
  return NextResponse.redirect(new URL(`/book/${slug}`, request.url), 301);
}
