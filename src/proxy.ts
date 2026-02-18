import { NextResponse, NextRequest } from 'next/server';

// Domains that enable the Ficino Society social layer
const SOCIETY_DOMAINS = [
  'ficinosociety.org',
  'www.ficinosociety.org',
  'ficino.sourcelibrary.org', // Subdomain on main domain
  'ficinosociety.local', // For local dev
  'ficino.local',
];

// --- Rate limiting ---
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function getClientIp(request: NextRequest): string {
  return (
    (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    request.headers.get('cf-connecting-ip') ||
    'unknown'
  );
}

function checkLimit(key: string, limit: number, windowSeconds: number): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return true;
  }

  // Lazy cleanup when store gets large
  if (rateLimitStore.size > 10000) {
    for (const [k, v] of rateLimitStore) {
      if (now > v.resetAt) rateLimitStore.delete(k);
    }
  }

  entry.count++;
  return entry.count <= limit;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Redirect www to non-www (SEO: canonical domain)
  const host = request.headers.get('host') || '';
  if (host.startsWith('www.sourcelibrary.org')) {
    const url = request.nextUrl.clone();
    url.host = 'sourcelibrary.org';
    return NextResponse.redirect(url, 301);
  }

  // Rate-limit API routes (except cron, which has its own auth)
  if (pathname.startsWith('/api/') && !pathname.startsWith('/api/cron/')) {
    const ip = getClientIp(request);
    const isExpensive =
      pathname.includes('/batch-ocr') ||
      pathname.includes('/batch-translate') ||
      pathname.includes('/queue-books') ||
      pathname.includes('/admin/') ||
      pathname.startsWith('/api/analytics/usage');

    const limit = isExpensive ? 10 : 60;
    const key = `${ip}:${isExpensive ? 'expensive' : 'public'}`;

    if (!checkLimit(key, limit, 60)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      );
    }
  }

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
