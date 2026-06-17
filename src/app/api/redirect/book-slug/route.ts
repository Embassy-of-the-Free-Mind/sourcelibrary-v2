import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { findBookByIdOrSlug } from '@/lib/book-lookup';

/**
 * Resolves /book/{non-slug-id} to /book/{slug} via 301 redirect.
 * Called via proxy rewrite so the book page component never calls redirect(),
 * which would force it into fully-dynamic rendering (no ISR).
 */
export async function GET(request: NextRequest) {
  // Proxy passes the id via header (survives the internal rewrite in dev).
  // Fall back to the query param for direct hits / older callers.
  const bookIdOrSlug =
    request.headers.get('x-redirect-book') || request.nextUrl.searchParams.get('id');

  if (!bookIdOrSlug) {
    return NextResponse.redirect(new URL('/', request.url), 302);
  }

  const db = await getReadDb();
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

  // If the resolved slug is the same as the input (no real slug exists), pass through
  // to avoid infinite redirect loops
  if (slug === bookIdOrSlug) {
    return NextResponse.next();
  }

  // Redirect non-slug URL to canonical slug URL
  return NextResponse.redirect(new URL(`/book/${slug}`, request.url), 301);
}
