import { NextRequest, NextResponse } from 'next/server';

/**
 * Domain-based routing middleware.
 * Rewrites ficinosociety.org root to the /ficino-society donor page.
 */
export function middleware(request: NextRequest) {
  const host = request.headers.get('host') || '';
  const { pathname } = request.nextUrl;

  // ficinosociety.org → serve the donor site at root
  if (host.includes('ficinosociety') || host.startsWith('ficino.')) {
    if (pathname === '/') {
      const url = request.nextUrl.clone();
      url.pathname = '/ficino-society';
      return NextResponse.rewrite(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  // Only run middleware on pages, not on static assets or API routes
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:jpg|png|webp|svg|webm|mp4)).*)'],
};
