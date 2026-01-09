import { NextResponse, NextRequest } from 'next/server';

// Domains that enable the Ficino Society social layer
const SOCIETY_DOMAINS = [
  'ficinosociety.org',
  'www.ficinosociety.org',
  'ficino.sourcelibrary.org', // Subdomain on main domain
  'ficinosociety.local', // For local dev
  'ficino.local',
];

export function proxy(request: NextRequest) {
  const host = request.headers.get('host') || '';

  // Check if this is a Ficino Society domain
  const isSociety = SOCIETY_DOMAINS.some(domain => host.includes(domain)) ||
    request.nextUrl.searchParams.get('society') === 'true'; // Dev override via ?society=true

  // Clone the request headers and add our custom header
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-site-mode', isSociety ? 'society' : 'library');

  // Pass the modified headers to the request
  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  // Match all paths except static files
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
