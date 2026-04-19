import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Middleware: Prevent Cloudflare from caching RSC flight data as HTML.
 *
 * CF Free plan ignores the Vary header (except Accept-Encoding), so RSC
 * responses (text/x-component) get cached and served to browsers expecting
 * HTML, showing raw React flight data instead of the page.
 *
 * Fix: Set CDN-Cache-Control: no-store on RSC requests so CF bypasses cache,
 * while keeping the normal Cache-Control for browsers.
 */
export function middleware(request: NextRequest) {
  // Only intercept RSC navigation requests (client-side route transitions)
  const isRsc = request.headers.get('rsc') === '1';
  if (!isRsc) return NextResponse.next();

  const response = NextResponse.next();

  // CDN-Cache-Control is respected by CF but stripped before reaching the browser.
  // This tells CF "don't cache this" without affecting browser caching.
  response.headers.set('CDN-Cache-Control', 'no-store');

  return response;
}

export const config = {
  // Match all page routes, skip API/static/image routes
  matcher: [
    '/((?!api|_next/static|_next/image|favicon|icon|apple-icon|brand|partners|robots|sitemap|opensearch).*)',
  ],
};
