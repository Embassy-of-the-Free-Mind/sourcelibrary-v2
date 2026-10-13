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
/** Repo-relative paths of every file under src/ whose name matches. */
const srcFiles = (name: RegExp, dir = 'src'): string[] =>
  readdirSync(path.join(repoRoot, dir), { withFileTypes: true }).flatMap(e => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return srcFiles(name, rel);
    return name.test(e.name) ? [rel] : [];
  });

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
    '/ideas',
    '/ideas/prima-materia',
    '/blog',
    '/contribute',
    '/support',
    '/sponsors',
    // the Librarian and everything behind it (#4330)
    '/librarian',
    '/librarian/thread/abc',
    '/librarian/voice',
    '/api/embassy/chat',
    '/api/embassy/voice-search',
    '/api/embassy/threads/abc',
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

  it.each(['/encyclopedia', '/encyclopedia/Matthiolus', '/explore/map', '/ngrams', '/libraries', '/librarian', '/api/embassy/threads'])(
    'leaves %s untouched on the global host',
    async (p) => {
      const res = await proxy(req(`https://sourcelibrary.org${p}`, 'sourcelibrary.org'));
      expect(res?.status).not.toBe(404);
    }
  );

  // The Librarian (#4330, decided 2026-10-10): refused on every partner host,
  // for every method and every route under /api/embassy; served on the apex.
  const LIBRARIAN_PATHS = [
    '/librarian',
    '/librarian/voice',
    '/api/embassy/chat',
    '/api/embassy/rooms',
    '/api/embassy/threads',
    '/api/embassy/voice',
    '/api/embassy/voice-search',
  ];
  const post = (url: string, host: string) =>
    new NextRequest(url, {
      method: 'POST',
      headers: { host, 'user-agent': 'Mozilla/5.0 Chrome/124', 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });

  it.each(['bph.sourcelibrary.org', 'bhutan.sourcelibrary.org'])(
    'refuses the Librarian and its API on the partner host %s',
    async (host) => {
      for (const p of LIBRARIAN_PATHS) {
        const res = await proxy(req(`https://${host}${p}`, host));
        expect(res?.status, `${host}${p}`).toBe(404);
      }
      const chat = await proxy(post(`https://${host}/api/embassy/chat`, host));
      expect(chat?.status, `POST ${host}/api/embassy/chat`).toBe(404);
    }
  );

  it.each(['sourcelibrary.org', 'www.sourcelibrary.org'])(
    'still serves the Librarian and its API on the main host %s',
    async (host) => {
      for (const p of LIBRARIAN_PATHS) {
        const res = await proxy(req(`https://${host}${p}`, host));
        expect(res?.status, `${host}${p}`).not.toBe(404);
      }
      const chat = await proxy(post(`https://${host}/api/embassy/chat`, host));
      expect(chat?.status, `POST ${host}/api/embassy/chat`).not.toBe(404);
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
    //
    // The child's href may be normalised on the way into the predicate — the nav
    // localizes hrefs, so a Spanish header holds `/es/works` and the lookup runs
    // on `canonicalPath(child.href)`. What this guard is for is that `child.href`
    // REACHES the predicate at all; pinning the exact argument expression made it
    // fail on a change that strengthened the very thing it protects.
    const src = read('src/components/layout/SiteHeader.tsx');
    expect(src, 'children must be run through the predicate too').toMatch(
      /children.*?\.filter\(\s*child\s*=>\s*!isGlobalOnlyNavHref\([^)]*child\.href/s
    );
  });

  it('no component links to the Librarian on a partner host without a host gate', () => {
    // The proxy 404s /librarian on tenant hosts (#4330). The header and footer
    // drop the link through isGlobalOnlyNavHref; these two write it by hand and
    // render on partner hosts, so each must gate it on the host.
    for (const f of ['src/app/search/page.tsx', 'src/components/search/UnifiedSearch.tsx']) {
      const src = read(f);
      expect(src, `${f} links to /librarian`).toContain('/librarian');
      expect(src, `${f} must gate that link on the host`).toMatch(/!isTenantSurface && \(/);
    }
  });

  it('every link to the Librarian in src/ is refused, filtered or host-gated on a partner host', () => {
    // #4330: the proxy 404s /librarian on tenant hosts, so a link to it on a
    // page a partner host serves is a dead link in the partner's reading room.
    // Each file that writes the path must be accounted for below; a new one
    // fails here until someone decides whether it can render on a tenant host.
    const LIBRARIAN_HREF = /['"`]\/librarian(?=[?'"`/])/;
    // Block comments and whole-line `//` comments are dropped: prose that
    // mentions `/librarian?thread=<id>` is not a link.
    const code = (f: string) =>
      read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const files = srcFiles(/\.(tsx?|json)$/).filter(f => LIBRARIAN_HREF.test(code(f)));

    // Served only under a path the proxy refuses on tenant hosts (`/es/…` is
    // 308'd off the path there first, landing on the refused `/librarian`).
    const UNDER_REFUSED_ROUTE = [
      /^src\/app\/librarian\//,
      /^src\/app\/es\/librarian\//,
      /^src\/app\/about\//,
      /^src\/app\/api\/embassy\//,
    ];
    // Not a rendered link: warm lists, route metadata, the locale registry,
    // the block list itself.
    const NOT_A_LINK = new Set([
      'src/app/api/admin/cache-probe/route.ts',
      'src/app/api/cron/warm/route.ts',
      'src/app/api/deploy-warm/route.ts',
      'src/lib/librarian-i18n.ts',
      'src/lib/locale-path.ts',
      'src/lib/tenant-global-paths.ts',
      // The site-feature registry: matchKnownEntity drops refused features on
      // a tenant host (tests/unit/known-entities.test.ts).
      'src/lib/site-features.json',
    ]);
    // Rendered only by HomeView, i.e. the apex home and its locale twins; the
    // proxy serves the partner's own home at `/` and 308s locale prefixes.
    const APEX_HOME_ONLY = new Set(['src/components/home/AskTheSourceBand.tsx']);
    // Rendered on partner hosts: the gate each one must carry.
    const GATED: Record<string, RegExp> = {
      'src/components/layout/SiteHeader.tsx': /isGlobalOnlyNavHref/,
      'src/app/search/page.tsx': /!isTenantSurface && \(/,
      'src/components/search/UnifiedSearch.tsx': /!isTenantSurface && \(/,
      'src/components/reader-v2/Reader2C.tsx': /siteMenuOpen && !isEmbedded/,
      'src/app/podcast/page.tsx': /<HideOnTenantHost>[\s\S]*href="\/librarian"[\s\S]*<\/HideOnTenantHost>/,
      // The link is the component itself; the next test pins that every page
      // rendering it wraps it in <HideOnTenantHost>.
      'src/components/LibrarianSearch.tsx': /\/librarian/,
    };

    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      if (UNDER_REFUSED_ROUTE.some(re => re.test(f)) || NOT_A_LINK.has(f) || APEX_HOME_ONLY.has(f)) continue;
      expect(GATED[f], `${f} links to /librarian: gate it on the host and list it here`).toBeDefined();
      expect(read(f), `${f} must gate its /librarian link on the host`).toMatch(GATED[f]);
    }
  });

  it('every page that renders LibrarianSearch hides it, and its jump link, on a partner host', () => {
    const importers = srcFiles(/\.tsx?$/).filter(f =>
      read(f).includes("from '@/components/LibrarianSearch'")
    );
    expect(importers.length).toBeGreaterThan(0);
    for (const f of importers) {
      const src = read(f);
      expect(src, `${f} must wrap LibrarianSearch in HideOnTenantHost`).toMatch(
        /<HideOnTenantHost>[\s\S]*<LibrarianSearch[\s\S]*<\/HideOnTenantHost>/
      );
      if (src.includes('CollectionAnchorBar')) {
        expect(src, `${f} must drop the Librarian jump link on a tenant host`).toMatch(
          /hideOnTenantHost: (true|id === 'librarian')/
        );
      }
    }
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
