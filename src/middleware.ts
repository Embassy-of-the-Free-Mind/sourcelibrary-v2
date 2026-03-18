import { NextRequest, NextResponse } from 'next/server';

/**
 * Domain-based routing middleware.
 * On ficinosociety.org, rewrites society-specific paths to their /ficino-society equivalents
 * so that ficinosociety.org/discussions → /ficino-society/discussions, etc.
 * All other paths (auth, api, books, etc.) pass through unchanged.
 */
export function middleware(request: NextRequest) {
  const host = request.headers.get('host') || '';
  const { pathname } = request.nextUrl;

  const isSocietyDomain = host.includes('ficinosociety') || host.startsWith('ficino.');

  if (isSocietyDomain) {
    // Root → main ficino society page
    if (pathname === '/') {
      const url = request.nextUrl.clone();
      url.pathname = '/ficino-society';
      return NextResponse.rewrite(url);
    }

    // Clean society paths: /discussions → /ficino-society/discussions, /members → /ficino-society/members
    const societyPaths = ['/discussions', '/members'];
    for (const p of societyPaths) {
      if (pathname === p || pathname.startsWith(p + '/')) {
        const url = request.nextUrl.clone();
        url.pathname = '/ficino-society' + pathname;
        return NextResponse.rewrite(url);
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:jpg|png|webp|svg|webm|mp4)).*)'],
};
