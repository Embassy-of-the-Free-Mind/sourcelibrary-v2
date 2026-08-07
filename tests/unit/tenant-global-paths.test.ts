/**
 * Tenant lockdown: corpus-wide surfaces must not answer on a partner subdomain
 * (issue #3364).
 *
 * Measured on production before the fix: `/encyclopedia/Matthiolus` served from
 * bph.sourcelibrary.org linked 121 books, 102 of which were NOT BPH holdings,
 * and `/api/entities` returned byte-identical global results on both hosts. The
 * existing crawler audit (`scripts/audit-bph-leaks.mjs`) could not catch it —
 * it asserts that links don't resolve OFF the subdomain, and these links are
 * relative, so they stay on-host while pointing at other libraries' books.
 *
 * These tests pin three things:
 *  1. the path predicate (prefix matching, no false positives)
 *  2. that routes verified as correctly tenant-scoped are NOT blocked
 *  3. that the proxy and the site nav read the SAME list, so the nav can never
 *     link to a path the proxy 404s
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, type Dirent } from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';

import { proxy } from '@/proxy';

import {
  GLOBAL_ONLY_TENANT_PAGE_PATHS,
  GLOBAL_ONLY_TENANT_API_PATHS,
  isGlobalOnlyTenantPath,
  isGlobalOnlyNavHref,
  TENANT_REACHABLE_INSTITUTIONAL_PATHS,
} from '@/lib/tenant-global-paths';

const repoRoot = path.resolve(__dirname, '../..');
const read = (p: string) => readFileSync(path.join(repoRoot, p), 'utf8');

describe('isGlobalOnlyTenantPath', () => {
  it('blocks the corpus-wide pages and their children', () => {
    expect(isGlobalOnlyTenantPath('/encyclopedia')).toBe(true);
    expect(isGlobalOnlyTenantPath('/encyclopedia/Matthiolus')).toBe(true);
    expect(isGlobalOnlyTenantPath('/explore')).toBe(true);
    expect(isGlobalOnlyTenantPath('/explore/timeline')).toBe(true);
    expect(isGlobalOnlyTenantPath('/explore/map')).toBe(true);
    expect(isGlobalOnlyTenantPath('/ngrams')).toBe(true);
    expect(isGlobalOnlyTenantPath('/libraries')).toBe(true);
    expect(isGlobalOnlyTenantPath('/libraries/internet-archive')).toBe(true);
  });

  it('blocks the unscoped APIs behind them — the pages render client-side', () => {
    expect(isGlobalOnlyTenantPath('/api/entities')).toBe(true);
    expect(isGlobalOnlyTenantPath('/api/entities?limit=5')).toBe(false); // query string is not part of pathname
    expect(isGlobalOnlyTenantPath('/api/explore/map')).toBe(true);
    expect(isGlobalOnlyTenantPath('/api/ngrams')).toBe(true);
  });

  it('leaves correctly tenant-scoped routes alone', () => {
    // Verified against production by diffing tenant vs global responses:
    // /api/search/unified returns different results per host, /gallery and
    // /collections render smaller tenant-filtered pages, /browse has
    // src/lib/tenant-browse.ts.
    for (const p of [
      '/search',
      '/api/search/unified',
      '/gallery',
      '/gallery/image/abc-0',
      '/collections',
      '/collections/alchemy',
      '/browse',
      '/browse/titles/A',
      '/book/some-slug',
      '/author/marsilio-ficino',
      '/',
    ]) {
      expect(isGlobalOnlyTenantPath(p), `${p} must stay reachable`).toBe(false);
    }
  });

  it('matches on path segments, not string prefixes', () => {
    expect(isGlobalOnlyTenantPath('/exploration')).toBe(false);
    expect(isGlobalOnlyTenantPath('/librariesXYZ')).toBe(false);
    expect(isGlobalOnlyTenantPath('/encyclopedias')).toBe(false);
  });
});

describe('isGlobalOnlyNavHref', () => {
  it('flags nav hrefs that the proxy would 404 on a tenant host', () => {
    // The site header links "Map" → /explore/map. Blocking the route without
    // dropping the link would leave a dead entry in the tenant's own nav.
    expect(isGlobalOnlyNavHref('/explore/map')).toBe(true);
    expect(isGlobalOnlyNavHref('/collections')).toBe(false);
    expect(isGlobalOnlyNavHref('/gallery')).toBe(false);
    expect(isGlobalOnlyNavHref('/browse')).toBe(false);
    // The works index is corpus-wide ("31 editions across 4 libraries"), so it
    // is blocked — but `/work/[id]`, the per-book edition rail, is not: it is
    // reached from a book page and gated by embedPolicy.showRelatedEditions.
    expect(isGlobalOnlyNavHref('/works')).toBe(true);
    expect(isGlobalOnlyNavHref('/work/boethius-de-consolatione-philosophiae')).toBe(false);
  });

  it('does not flag API paths — those are never nav targets', () => {
    expect(isGlobalOnlyNavHref('/api/entities')).toBe(false);
  });
});

/**
 * Behavioral tests against the real proxy.
 *
 * These exist because the obvious end-to-end check does NOT work: curling a
 * Vercel PREVIEW url with `Host: bph.sourcelibrary.org` does not exercise the
 * preview build at all — Vercel's router resolves the Host to the PRODUCTION
 * deployment for that domain and serves it. During review that produced a
 * convincing false negative (every blocked path answered 200, including a real
 * BPH landing page at `/`) which looked exactly like a broken fix. Calling
 * proxy() directly is the only deterministic check short of deploying.
 */
describe('proxy behavior', () => {
  const req = (url: string, host: string) =>
    new NextRequest(url, {
      headers: {
        host,
        'user-agent': 'Mozilla/5.0 Chrome/124',
        'accept-language': 'en',
        'sec-fetch-mode': 'navigate',
      },
    });

  it.each([
    // corpus-wide aggregations (#3364)
    '/encyclopedia',
    '/encyclopedia/Matthiolus',
    '/explore/timeline',
    '/explore/map',
    '/ngrams',
    '/libraries',
    '/libraries/internet-archive',
    '/api/entities',
    // Source Library's own institutional pages (#3370)
    '/about',
    '/about/progress',
    '/vision',
    '/census',
    '/research',
    '/blog',
    '/contribute',
    '/support',
    '/sponsors',
  ])('404s %s on a tenant subdomain', async (p) => {
    const res = await proxy(req(`https://bph.sourcelibrary.org${p}`, 'bph.sourcelibrary.org'));
    expect(res?.status).toBe(404);
  });

  it.each(TENANT_REACHABLE_INSTITUTIONAL_PATHS)(
    'keeps the legal/policy page %s reachable on a tenant subdomain',
    async (p) => {
      // Rights notices must be served on whatever host answers, and
      // /terms, /privacy, /dmca, /licensing and /developers sit in the
      // crawler-readable allow-lists the three-layer AI-access gate depends on.
      // /in-memoriam honours Joost Ritman, whose library IS the BPH collection.
      const res = await proxy(req(`https://bph.sourcelibrary.org${p}`, 'bph.sourcelibrary.org'));
      expect(res?.status).not.toBe(404);
    }
  );

  it.each(['/collections', '/gallery', '/browse', '/search'])(
    'leaves the correctly-scoped route %s reachable on a tenant subdomain',
    async (p) => {
      const res = await proxy(req(`https://bph.sourcelibrary.org${p}`, 'bph.sourcelibrary.org'));
      expect(res?.status).not.toBe(404);
    }
  );

  it.each(['/encyclopedia', '/encyclopedia/Matthiolus', '/explore/map', '/ngrams', '/libraries'])(
    'leaves %s untouched on the global host',
    async (p) => {
      const res = await proxy(req(`https://sourcelibrary.org${p}`, 'sourcelibrary.org'));
      expect(res?.status).not.toBe(404);
    }
  );
});

describe('the block list and the carve-out cannot overlap', () => {
  it('no institutional path is both blocked and declared reachable', () => {
    for (const keep of TENANT_REACHABLE_INSTITUTIONAL_PATHS) {
      expect(
        isGlobalOnlyTenantPath(keep),
        `${keep} is declared tenant-reachable but the proxy blocks it`
      ).toBe(false);
    }
  });
});

describe('wiring', () => {
  it('blocks before the tenant rewrite, or the page would be served first', () => {
    const src = read('src/proxy.ts');
    const blockAt = src.indexOf('isGlobalOnlyTenantPath(pathname)');
    const rewriteAt = src.indexOf("!pathname.startsWith('/embed/')");
    expect(blockAt).toBeGreaterThan(-1);
    expect(rewriteAt).toBeGreaterThan(-1);
    expect(blockAt, 'block must come before the tenant rewrite').toBeLessThan(rewriteAt);
  });

  it('the site nav filters on the same list the proxy enforces', () => {
    const src = read('src/components/layout/SiteHeader.tsx');
    expect(src, 'header must import the shared predicate').toContain(
      "from '@/lib/tenant-global-paths'"
    );
    expect(src).toContain('isGlobalOnlyNavHref');
  });

  it('the site nav filters dropdown children, not just top-level links', () => {
    // `/works` sits under the Browse dropdown and is global-only. Filtering only
    // `link.href` would leave it in a partner's header pointing at a page the
    // proxy 404s — the exact failure this shared list exists to prevent.
    const src = read('src/components/layout/SiteHeader.tsx');
    expect(src, 'children must be run through the predicate too').toMatch(
      /children.*\.filter\(\s*child\s*=>\s*!isGlobalOnlyNavHref\(child\.href\)\s*\)/s
    );
  });

  it('every blocked page path is a real route in the app tree', () => {
    // A typo here would silently block nothing. Each entry must correspond to a
    // directory under src/app.
    for (const p of GLOBAL_ONLY_TENANT_PAGE_PATHS) {
      const dir = path.join(repoRoot, 'src/app', p.replace(/^\//, ''));
      expect(() => readFileSync(path.join(dir, 'page.tsx')), `${p} should exist`).not.toThrow();
    }
  });

  it('every blocked API path is a real route handler', () => {
    // A typo here would silently block nothing. Each entry must be a directory
    // that holds a route handler, either directly or in a child segment —
    // several blocked prefixes (/api/explore, /api/review) are parent segments
    // whose children carry the handlers.
    const hasRouteHandler = (dir: string): boolean => {
      let entries: Dirent[];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return false;
      }
      if (entries.some(e => e.isFile() && /^route\.tsx?$/.test(e.name))) return true;
      return entries.some(e => e.isDirectory() && hasRouteHandler(path.join(dir, e.name)));
    };

    for (const p of GLOBAL_ONLY_TENANT_API_PATHS) {
      const dir = path.join(repoRoot, 'src/app', p.replace(/^\//, ''));
      expect(hasRouteHandler(dir), `${p} should resolve to a route handler`).toBe(true);
    }
  });
});
