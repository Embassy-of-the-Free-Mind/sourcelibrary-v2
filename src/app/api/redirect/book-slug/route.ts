import { NextRequest, NextResponse } from 'next/server';
import { getReadDb } from '@/lib/mongodb';
import { findBookByIdOrSlug } from '@/lib/book-lookup';

/**
 * Resolves /book/{non-slug-id} to /book/{slug} via 301 redirect, and
 * /book/{non-slug-id}/page/{pageId} to /book/{slug}/page/{pageId}.
 * Called via proxy rewrite so the book page component never calls redirect(),
 * which would force it into fully-dynamic rendering (no ISR).
 */
export async function GET(request: NextRequest) {
  // Proxy passes the id via header (survives the internal rewrite in dev).
  // Fall back to the query param for direct hits / older callers.
  const bookIdOrSlug =
    request.headers.get('x-redirect-book') || request.nextUrl.searchParams.get('id');

  // Reader URLs carry a page tail and a query string that must survive the
  // redirect — ?highlight= pins a search term, ?v= pins a cited edition
  // version, and dropping either silently changes what the reader lands on.
  const pageId = request.headers.get('x-redirect-page-id') || '';
  const tail = pageId ? `/page/${encodeURIComponent(pageId)}` : '';
  const search = request.headers.get('x-redirect-search') || '';

  if (!bookIdOrSlug) {
    return NextResponse.redirect(new URL('/', request.url), 302);
  }

  const db = await getReadDb();
  const result = await findBookByIdOrSlug(db, bookIdOrSlug, { id: 1, slug: 1 });

  // "No redirect needed" — either the book isn't found (page renders its 404),
  // or its canonical URL already IS /book/<input> (a book with no distinct slug,
  // or matched directly by slug). We can't `NextResponse.next()` here: this is a
  // route handler (not middleware), so next() throws "NextResponse.next() was used
  // in a route handler" and surfaces as a 500 — which is exactly what was breaking
  // every invalid book id and the ~29 visible books that have no slug.
  //
  // Instead, bounce back to /book/<input> with an `ns` marker. The proxy skips its
  // id→resolver rewrite when `ns` is present (so no loop), and /book/[id] renders
  // the book or calls notFound() for a real, styled 404.
  const renderInPlace = () => {
    const url = new URL(`/book/${encodeURIComponent(bookIdOrSlug)}${tail}${search}`, request.url);
    url.searchParams.set('ns', '1');
    return NextResponse.redirect(url, 302);
  };

  if (!result) {
    return renderInPlace();
  }

  const slug = (result.book.slug || result.book.id || result.book._id?.toString()) as string;

  // Lookup matched by slug, or the canonical slug is the same as the input → no
  // real redirect target; render in place.
  if (result.matchedBySlug || slug === bookIdOrSlug) {
    return renderInPlace();
  }

  // Redirect non-slug URL to canonical slug URL
  const target = new URL(`/book/${slug}${tail}${search}`, request.url);
  // A <Link> to the id form prefetches it as an RSC request carrying Next's
  // `_rsc` cache-busting param. A Location without that param makes the client
  // discard the response the browser fetched by following the 301 and fetch the
  // slug a second time — three requests per link, and the discarded one is an
  // RSC-headed request to the bare slug URL, which the CDN answers with the
  // cached HTML document (it does not key on the RSC header). Carrying `_rsc`
  // through settles the client on the slug in one hop (#6438). Next forwards
  // `_rsc` onto the proxy's rewrite target, so it is on this request's URL.
  // Gated on the RSC header so a plain, CDN-cacheable 301 never carries it.
  const rsc = request.nextUrl.searchParams.get('_rsc');
  if (rsc && request.headers.get('rsc') === '1') {
    target.searchParams.set('_rsc', rsc);
  }
  return NextResponse.redirect(target, 301);
}
