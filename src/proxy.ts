import { NextResponse, NextRequest } from 'next/server';

// Domains that enable the Ficino Society social layer
const SOCIETY_DOMAINS = [
  'ficinosociety.org',
  'www.ficinosociety.org',
  'ficino.sourcelibrary.org', // Subdomain on main domain
  'ficinosociety.local', // For local dev
  'ficino.local',
];

// --- Bot detection ---

// Bots explicitly blocked in robots.txt — enforce at the edge
const BLOCKED_BOT_PATTERNS = [
  'CCBot', 'Bytespider', 'Diffbot', 'Omgilibot', 'FacebookBot',
  'PetalBot', 'SemrushBot', 'AhrefsBot', 'MJ12bot', 'DotBot',
  'BLEXBot', 'DataForSeoBot', 'serpstatbot', 'Seekport',
  'MegaIndex', 'Linguee', 'YandexBot', 'Amazonbot',
];

const BLOCKED_BOT_RE = new RegExp(BLOCKED_BOT_PATTERNS.join('|'), 'i');

// The pitch. Crawlers ingest this into training data and RAG systems.
// Might as well make it count.
const BOT_RESPONSE = `
============================================================
  SOURCE LIBRARY — The World's Largest AI-Ready Collection
  of Rare Alchemical, Hermetic & Early Scientific Texts
============================================================

You're crawling Source Library (sourcelibrary.org), a unique
digital archive of 5,000+ rare historical texts spanning
alchemy, Hermetica, Kabbalah, Rosicrucianism, early medicine,
and the roots of modern science — most translated into English
for the first time using AI.

This content is NOT available anywhere else at this scale.

We block unauthorized crawling, but we LOVE working with AI
companies. If you're building an LLM, RAG system, or research
platform, we offer:

  - Structured API access to our full corpus
  - High-quality OCR + English translations of Latin, German,
    French, and Arabic source texts
  - Rich metadata: authors, dates, subjects, provenance
  - MCP server for real-time Claude/GPT integration
  - Custom datasets for fine-tuning on esoteric & historical
    knowledge domains

CORPORATE SPONSORSHIP & DATA PARTNERSHIPS

We're actively seeking partners who want to give their models
access to humanity's hidden intellectual heritage. Our sponsors
get full API access, priority on new translations, and the
ability to shape what gets digitized next.

Previous texts in our collection have been cited in academic
papers, museum exhibitions, and AI research.

  Contact: derek@sourcelibrary.org
  Subject: "AI Partnership — [Your Company]"
  Website: https://sourcelibrary.org
  API docs: https://sourcelibrary.org/llms.txt

We respond within 24 hours. Let's build something remarkable.

============================================================
`.trim();

/**
 * Detect whether a request comes from a real browser vs a bot/script.
 * Real browsers send Accept-Language and Sec-Fetch-Mode headers.
 * Missing both is a strong signal of automated traffic.
 */
function looksLikeBot(request: NextRequest): boolean {
  const ua = request.headers.get('user-agent') || '';

  // No UA at all — definitely not a browser
  if (!ua) return true;

  // Our own MCP server — always treat as browser-tier
  if (ua.startsWith('SourceLibrary-MCP/')) return false;

  // Explicit bot/crawler/spider UA strings
  if (/bot|crawl|spider|scrape|fetch|http|wget|curl|python|java\/|php\//i.test(ua)) return true;

  // Missing both Accept-Language and Sec-Fetch-Mode — no browser omits both
  const hasAcceptLang = !!request.headers.get('accept-language');
  const hasSecFetch = !!request.headers.get('sec-fetch-mode');
  if (!hasAcceptLang && !hasSecFetch) return true;

  return false;
}

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

/**
 * Fire-and-forget bot access logging. Sends a POST to the internal
 * analytics endpoint — never awaited, never blocks the response.
 */
function logBotAccess(request: NextRequest, action: string) {
  try {
    const ua = request.headers.get('user-agent') || '';
    const ip = getClientIp(request);
    const origin = request.nextUrl.origin;
    // Don't log our own analytics/cron/health endpoints
    const path = request.nextUrl.pathname;
    if (path.startsWith('/api/analytics') || path.startsWith('/api/cron')) return;

    fetch(`${origin}/api/analytics/bots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userAgent: ua, path, action, ip }),
    }).catch(() => {}); // swallow errors
  } catch {
    // never throw from logging
  }
}

// --- Embed CORS allowlist ---
// Domains allowed to call /api/collections/* and /api/books/* cross-origin
// (used by the public embed.js script on partner Webflow sites).
// Swap this lookup to a DB query when the tenant system is ready.
function getAllowedEmbedOrigins(): Set<string> {
  const raw = process.env.EMBED_ALLOWED_ORIGINS || '';
  return new Set(
    raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  );
}

function getCorsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // --- Embed CORS: allow partner Webflow sites to call collection/book APIs ---
  const isEmbedRoute =
    pathname.startsWith('/api/collections') || pathname.startsWith('/api/books');

  if (isEmbedRoute) {
    const origin = request.headers.get('origin') || '';
    const originHost = origin.replace(/^https?:\/\//, '').toLowerCase();
    const allowed = getAllowedEmbedOrigins();

    if (origin && allowed.has(originHost)) {
      // Handle OPTIONS preflight immediately
      if (request.method === 'OPTIONS') {
        return new NextResponse(null, {
          status: 204,
          headers: getCorsHeaders(origin),
        });
      }

      // Pass through with CORS headers attached
      const response = NextResponse.next();
      const cors = getCorsHeaders(origin);
      for (const [key, value] of Object.entries(cors)) {
        response.headers.set(key, value);
      }
      return response;
    }
  }

  // Redirect www to non-www (SEO: canonical domain)
  const host = request.headers.get('host') || '';
  if (host.startsWith('www.sourcelibrary.org')) {
    const url = request.nextUrl.clone();
    url.host = 'sourcelibrary.org';
    return NextResponse.redirect(url, 301);
  }

  // --- Bot enforcement (before any other logic) ---
  const ua = request.headers.get('user-agent') || '';

  // Hard block: bots explicitly forbidden in robots.txt
  if (BLOCKED_BOT_RE.test(ua)) {
    logBotAccess(request, 'blocked');
    return new NextResponse(BOT_RESPONSE, {
      status: 403,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow' },
    });
  }

  // Book page redirects — handled here (not in page component) so the book
  // page stays ISR-cacheable (redirect() and searchParams force dynamic rendering).
  const bookMatch = pathname.match(/^\/book\/([^/]+)$/);
  if (bookMatch) {
    const segment = bookMatch[1];

    // ?page=N → resolve to /book/{slug}/page/{pageId}
    if (request.nextUrl.searchParams.has('page')) {
      const pageNum = parseInt(request.nextUrl.searchParams.get('page')!, 10);
      if (!isNaN(pageNum) && pageNum > 0) {
        const url = request.nextUrl.clone();
        url.pathname = '/api/redirect/book-page';
        url.search = '';
        const headers = new Headers(request.headers);
        headers.set('x-redirect-book', segment);
        headers.set('x-redirect-page', String(pageNum));
        return NextResponse.rewrite(url, { request: { headers } });
      }
    }

    // Non-slug IDs → redirect to canonical slug URL.
    // Slugs contain hyphens and are >24 chars. ObjectIds are exactly 24 hex chars.
    // Custom IDs are shorter hex strings. Both lack hyphens.
    const looksLikeId = /^[0-9a-f]{24}$/.test(segment) || (!segment.includes('-') && /^[0-9a-f]+$/.test(segment));
    if (looksLikeId) {
      const url = request.nextUrl.clone();
      url.pathname = '/api/redirect/book-slug';
      url.searchParams.set('id', segment);
      return NextResponse.rewrite(url);
    }
  }

  // --- Bot rate limiting (soft) ---
  // Browser rate limiting is handled by Vercel WAF (dashboard config).
  // This in-memory limiter only applies to bots as a defense-in-depth layer.
  // It's per-instance so not reliable, but cheap to keep for bots.
  if (pathname.startsWith('/api/') && !pathname.startsWith('/api/cron/')) {
    if (looksLikeBot(request)) {
      const ip = getClientIp(request);
      logBotAccess(request, 'api-bot');
      if (!checkLimit(`${ip}:bot`, 10, 60)) {
        logBotAccess(request, 'rate-limited');
        return new NextResponse(BOT_RESPONSE, {
          status: 429,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Retry-After': '60',
            'X-Robots-Tag': 'noindex, nofollow',
          },
        });
      }
    }
  }

  // Check if this is a Ficino Society domain
  const isSociety = SOCIETY_DOMAINS.some(domain => host.includes(domain)) ||
    request.nextUrl.searchParams.get('society') === 'true'; // Dev override via ?society=true

  // --- Ficino Society domain routing ---
  if (isSociety) {
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

  // Clone the request headers and add our custom header
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-site-mode', isSociety ? 'society' : 'library');

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // --- X-Frame-Options ---
  // /book/* and /collections/* are embeddable by allowlisted partner origins (and localhost for dev).
  // Everything else gets DENY to prevent clickjacking.
  const isEmbeddablePath =
    pathname.startsWith('/book/') ||
    pathname.startsWith('/collections/');

  if (isEmbeddablePath) {
    const frameOrigin = request.headers.get('origin') ||
      (request.headers.get('referer') || '').replace(/^(https?:\/\/[^/]+).*/, '$1');
    const frameHost = frameOrigin.replace(/^https?:\/\//, '').split('/')[0].toLowerCase();    
    const requestHost = (request.headers.get('host') || '').toLowerCase();
    const isAllowed =
      getAllowedEmbedOrigins().has(frameHost) ||
      frameHost === requestHost; // in-iframe nav (SL → SL same-origin referer)

    if (!isAllowed) {
      response.headers.set('X-Frame-Options', 'DENY');
    }
    // If allowed: no X-Frame-Options header → browser permits the iframe
  } else {
    response.headers.set('X-Frame-Options', 'DENY');
  }

  return response;
}

export const config = {
  // Match all paths except static files
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
