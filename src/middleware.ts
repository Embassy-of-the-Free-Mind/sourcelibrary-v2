import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import redirectMap from '@/lib/author-canonical-redirects.json';

/**
 * Canonical author-URL redirects (#2250). One person had many /author/ URLs
 * (variant name-order, Latinized forms, title-contaminated strings); the
 * `authors` thesaurus knows the one canonical slug per person.
 *
 * This MUST run in middleware, not the page: a server `redirect()` inside the
 * `/author/[name]` RSC page does not emit an HTTP 307 (the page is ISR/streamed,
 * so the 200 shell commits before the redirect resolves — curl and crawlers see
 * 200, never the canonical URL). Middleware runs first and returns a real 308.
 *
 * The map is a precomputed variant-slug → canonical-slug table
 * (scripts/maintenance/build-author-redirect-map.mjs), bundled because middleware
 * has no DB access. It excludes any variant that is itself another person's
 * canonical slug. Content-level dedup (the merged book set) is handled by the
 * page; this only canonicalizes the URL.
 *
 * Defensive by construction: anything not an exact single-segment /author/<variant>
 * hit falls through untouched, so middleware can never break author routing.
 */
const MAP = redirectMap as Record<string, string>;

export function middleware(req: NextRequest) {
  try {
    const m = req.nextUrl.pathname.match(/^\/author\/([^/]+)\/?$/);
    if (m) {
      const raw = m[1];
      let decoded = raw;
      try { decoded = decodeURIComponent(raw); } catch { /* keep raw */ }
      const canonical = MAP[decoded] ?? MAP[raw];
      if (canonical && canonical !== decoded && canonical !== raw) {
        const url = req.nextUrl.clone();
        url.pathname = `/author/${canonical}`;
        return NextResponse.redirect(url, 308); // permanent: variant → canonical person
      }
    }
  } catch { /* fall through — never break /author on a middleware error */ }
  return NextResponse.next();
}

// Scope tightly to single-segment author URLs. Sub-paths like
// /author/[name]/opengraph-image (two segments) and all other routes are untouched.
export const config = {
  matcher: ['/author/:slug'],
};
