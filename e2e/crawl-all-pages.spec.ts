/**
 * Full-site crawl — hit every static page route and sample dynamic ones.
 * Reports all broken pages in a single test run.
 *
 * Run: npx playwright test crawl-all-pages --reporter=list
 */
import { test, expect } from '@playwright/test';

// All static (non-dynamic) page routes derived from src/app
const STATIC_PAGES = [
  '/',
  '/about',
  '/about/faq',
  '/about/processing',
  '/about/progress',
  '/about/research',
  '/about/sources',
  '/account',
  '/admin',
  '/admin/book-collections',
  '/admin/catalog-coverage',
  '/admin/collections',
  '/admin/duplicates',
  '/admin/email',
  '/admin/errors',
  '/admin/kdp',
  '/admin/marketing',
  '/admin/members',
  '/admin/outreach',
  '/admin/pipeline',
  '/admin/processing',
  '/admin/realtime',
  '/admin/social',
  '/admin/system-map',
  '/analytics',
  '/artwork',
  '/auth/error',
  '/auth/signin',
  '/auth/verify',
  '/beta',
  '/blog',
  '/blog/2000-first-translations',
  '/blog/astrological-diagrams',
  '/blog/autonomous-agents',
  '/blog/chakra-tradition',
  '/blog/clustering',
  '/blog/counting-the-gap',
  '/blog/cuneiform-ocr',
  '/blog/demonology',
  '/blog/fechner-bohme',
  '/blog/fire-horse',
  '/blog/first-translation-methodology',
  '/blog/first-translations',
  '/blog/hidden-engineers',
  '/blog/hieroglyph-ocr',
  '/blog/history-of-astrology',
  '/blog/history-of-classification',
  '/blog/indigenous-traditions',
  '/blog/invisible-hand',
  '/blog/mcp-server',
  '/blog/ocr-consistency',
  '/blog/origin-story',
  '/blog/philosophers-stone',
  '/blog/progress-studies',
  '/blog/rashi-ocr',
  '/blog/rithmomachia',
  '/blog/translation-rate',
  '/blog/untranslated-renaissance',
  '/blog/visualizing-classification',
  '/blog/why-terminals-cant-edit',
  '/blog/worlds-largest-collection',
  '/brand',
  '/brand/mockups',
  '/browse',
  '/catalog',
  '/categories',
  '/collections',
  '/collections/contemplative-traditions',
  '/collections/sacred-texts',
  '/contribute',
  '/contribute/volunteer',
  '/contribute/wikipedia',
  '/data',
  '/dataset',
  '/design-options',
  '/design-options/all-editorial',
  '/developers',
  '/developers/pipeline',
  '/embassy',
  '/encyclopedia',
  '/experiments',
  '/experiments/compare',
  '/experiments/ocr-quality',
  '/explore',
  '/explore/map',
  '/explore/timeline',
  '/favorites',
  '/feedback',
  '/ficino-society',
  '/ficino-society/discussions',
  '/ficino-society/members',
  '/gallery',
  '/gallery/collections',
  '/gallery/curate',
  '/gallery/review',
  '/hieroglyphs',
  '/languages',
  '/libraries',
  '/press-release',
  '/privacy',
  '/reading-history',
  '/rithmomachia',
  '/rithmomachia/guide',
  '/rithmomachia/scenarios',
  '/roadmap',
  '/search',
  '/shwep',
  '/support',
  '/tablets',
  '/taxonomy',
  '/terms',
  '/timeline',
  '/topics',
  '/topics/clusters',
  '/unauthorized',
  '/upload',
];

// Dynamic pages with known-good sample slugs — cover every dynamic route template
const DYNAMIC_PAGES = [
  // /book/[id] — multiple books to catch template bugs.
  // NOTE: these are exact current slugs; books get re-slugged by dedup/merge,
  // so if one starts 404ing it's stale test data, not a broken reader — refresh
  // the slug (search the API, follow the /book/<id> 301) rather than "restoring"
  // content. (Two slugs replaced 2026-07-21 for exactly this reason, #3109.)
  '/book/the-hermetic-museum-various-sendivogius',
  '/book/theatrum-chemicum-vol-vi-ed',
  '/book/three-books-of-occult-philosophy-nettesheim-2',

  // /collections/[id] — broad sample across collection types
  '/collections/alchemy',
  '/collections/classical-philosophy',
  '/collections/hermetica',
  '/collections/kabbalah',
  '/collections/secret-societies',
  '/collections/astrology',
  '/collections/natural-philosophy',
  '/collections/mysticism',

  // /browse/authors/[letter]
  '/browse/authors/A',
  '/browse/authors/F',
  '/browse/authors/M',
  '/browse/authors/P',

  // /browse/titles/[letter]
  '/browse/titles/A',
  '/browse/titles/D',
  '/browse/titles/T',

  // /browse/years/[period]
  '/browse/years/ancient',
  '/browse/years/medieval',
  '/browse/years/1500s',
  '/browse/years/1600s',
  '/browse/years/1700s',

  // /libraries/[slug]
  '/libraries/internet-archive',
  '/libraries/embassy-of-the-free-mind',

  // /languages/[code]
  '/languages/latin',
  '/languages/german',
  '/languages/french',
  '/languages/greek',
  '/languages/hebrew',

  // /author/[name]
  '/author/Marsilio-Ficino',
  '/author/Paracelsus',
  '/author/Heinrich-Cornelius-Agrippa',
  '/author/Robert-Fludd',

  // /search with queries
  '/search?q=alchemy',
  '/search?q=Ficino',
  '/search?q=translation',

  // /artwork pages
  '/artwork',

  // /encyclopedia/[name]
  '/encyclopedia/Hermes%20Trismegistus',
];

const ALL_PAGES = [...STATIC_PAGES, ...DYNAMIC_PAGES];

// Error patterns that indicate a broken page
const ERROR_PATTERNS = [
  'Application error',
  'Internal Server Error',
  'This page could not be found',
  'NEXT_NOT_FOUND',
  'Unhandled Runtime Error',
  'TypeError:',
  'ReferenceError:',
  'Cannot read properties of',
];

// URL patterns that are KNOWN to be broken in production but not yet fixed.
// The crawl reports them but does not fail the test. Remove an entry once its
// bug is fixed — that converts the test into a regression guard automatically.
//
// #2083 (/browse/{authors,artists,titles}/[A-Z] and /browse/years/*) is fixed
// and verified (all return 200) — entries removed 2026-07-02. Nothing to
// suppress right now; /data is a known-broken page tracked separately (fix in
// flight in a parallel PR) and is deliberately NOT allowlisted here so it
// still fails this test until it's actually fixed.
const EXPECTED_BROKEN_PATTERNS: RegExp[] = [];

function isExpectedBroken(path: string): boolean {
  return EXPECTED_BROKEN_PATTERNS.some(re => re.test(path));
}

// Pages where a 4xx response is expected/ok — either auth-protected (redirect
// to sign-in) or intentionally tenant-only with no apex equivalent (404 on
// apex by design). The crawl logs status for these but does not flag them as
// "broken" when status >= 400.
const AUTH_PAGES = new Set([
  // Auth-protected (member/admin areas)
  '/account',
  '/favorites',
  '/reading-history',
  '/admin',
  '/admin/book-collections',
  '/admin/catalog-coverage',
  '/admin/collections',
  '/admin/duplicates',
  '/admin/email',
  '/admin/errors',
  '/admin/kdp',
  '/admin/marketing',
  '/admin/members',
  '/admin/outreach',
  '/admin/pipeline',
  '/admin/processing',
  '/admin/realtime',
  '/admin/social',
  '/admin/system-map',
  '/analytics',
  '/gallery/curate',
  '/gallery/review',
  '/qa',
  '/upload',
  // Intentionally tenant-only (see proxy.ts GLOBAL_TENANT_ROUTES — these are
  // NOT in that set, so they 404 on apex by design).
  '/curated',
  '/fulldata',
  '/jobs',
  '/processing',
  '/scan',
  '/scan/auto',
  '/scan/opencv',
  '/research',
  '/research/atlas',
  '/research/concept-diffusion',
  '/research/image-atlas',
  '/research/image-pixplot',
  '/research/thumbnail-compare',
  '/research/translation-lag',
]);

interface PageResult {
  path: string;
  status: number | null;
  error: string | null;
  loadTimeMs: number;
}

// Shared helper: check a single URL and return the result
async function checkPage(
  request: { get: (url: string, opts?: { timeout?: number }) => Promise<any> },
  path: string,
  isAuth: boolean
): Promise<PageResult> {
  const start = Date.now();
  try {
    const response = await request.get(path, { timeout: 30_000 });
    const status = response.status();
    const elapsed = Date.now() - start;

    let error: string | null = null;

    if (isAuth) {
      if (status >= 500) {
        error = `Server error ${status}`;
      }
    } else if (status >= 400) {
      error = `HTTP ${status}`;
    }

    // Check response body for error messages on pages that returned 200
    if (status === 200 && !isAuth) {
      const body = await response.text();
      for (const pattern of ERROR_PATTERNS) {
        if (body.includes(pattern)) {
          error = `Page returned 200 but contains error: "${pattern}"`;
          break;
        }
      }
    }

    return { path, status, error, loadTimeMs: elapsed };
  } catch (err: any) {
    const elapsed = Date.now() - start;
    return {
      path,
      status: null,
      error: `Request failed: ${err.message?.slice(0, 100)}`,
      loadTimeMs: elapsed,
    };
  }
}

function printResults(results: PageResult[], broken: PageResult[], label: string) {
  console.log(`\n========== ${label} ==========`);
  console.log(`Total pages tested: ${results.length}`);
  console.log(`Passed: ${results.length - broken.length}`);
  console.log(`Broken: ${broken.length}`);

  if (broken.length > 0) {
    console.log('\n--- BROKEN PAGES ---');
    for (const b of broken) {
      console.log(`  ${b.status ?? 'TIMEOUT'} | ${b.path} | ${b.error} (${b.loadTimeMs}ms)`);
    }
  }

  const slow = results.filter(r => r.loadTimeMs > 10_000 && !r.error);
  if (slow.length > 0) {
    console.log('\n--- SLOW PAGES (>10s) ---');
    for (const s of slow) {
      console.log(`  ${s.loadTimeMs}ms | ${s.path}`);
    }
  }

  console.log('\n====================================\n');
}

test.describe('Full site crawl', () => {
  test.setTimeout(600_000); // 10 minutes

  test('crawl all pages and report broken ones', async ({ request }) => {
    // Run checks in parallel batches. Sequential with a 200ms delay used to
    // blow the 10-min budget at ~250 pages × 3s avg page-load. Batches of 8
    // bring the wall clock under 2 min on a warm deploy while still being
    // gentle enough to avoid rate limits.
    const BATCH = 8;
    const results: PageResult[] = [];
    const broken: PageResult[] = [];

    for (let i = 0; i < ALL_PAGES.length; i += BATCH) {
      const slice = ALL_PAGES.slice(i, i + BATCH);
      const batch = await Promise.all(slice.map(path => {
        const isAuth = AUTH_PAGES.has(path.split('?')[0]);
        return checkPage(request, path, isAuth);
      }));
      for (const result of batch) {
        results.push(result);
        if (result.error) broken.push(result);
      }
    }

    printResults(results, broken, 'CRAWL RESULTS');

    // Strip out known-broken pages tracked elsewhere — they print above but
    // do not fail the test. Real regressions still fail.
    const unexpectedBroken = broken.filter(b => !isExpectedBroken(b.path));
    if (broken.length !== unexpectedBroken.length) {
      console.log(`Suppressed ${broken.length - unexpectedBroken.length} EXPECTED_BROKEN failures (see EXPECTED_BROKEN set in this file).`);
    }
    expect(
      unexpectedBroken.map(b => `${b.status ?? 'TIMEOUT'} ${b.path}: ${b.error}`),
      `${unexpectedBroken.length} unexpected broken pages found`
    ).toHaveLength(0);
  });
});

test.describe('Link follower', () => {
  test.setTimeout(600_000); // 10 minutes

  test('follow internal links from key pages and verify they resolve', async ({ page, request }) => {
    // Seed pages to start crawling from — these are high-traffic pages with many links
    const SEED_PAGES = [
      '/',
      '/collections',
      '/browse',
      '/languages',
      '/libraries',
      '/about',
      '/embassy',
    ];

    const baseUrl = (page as any)._browserContext._options?.baseURL
      || process.env.BASE_URL
      || '';

    const visited = new Set<string>();
    const discovered = new Set<string>();
    const results: PageResult[] = [];
    const broken: PageResult[] = [];

    // Collect all internal links from seed pages
    for (const seedPath of SEED_PAGES) {
      try {
        await page.goto(seedPath, { waitUntil: 'domcontentloaded', timeout: 30_000 });

        // Extract all internal hrefs
        const hrefs = await page.evaluate((base: string) => {
          const links = document.querySelectorAll('a[href]');
          const paths: string[] = [];
          for (const link of links) {
            const href = link.getAttribute('href');
            if (!href) continue;

            // Skip external links, anchors, mailto, tel, javascript
            if (href.startsWith('http') && !href.startsWith(base)) continue;
            if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;

            // Normalize: strip base URL prefix, keep path + query
            let path = href;
            if (path.startsWith(base)) path = path.slice(base.length);
            if (!path.startsWith('/')) continue;

            // Strip hash fragments
            path = path.split('#')[0];
            if (!path) continue;

            paths.push(path);
          }
          return [...new Set(paths)];
        }, baseUrl);

        for (const href of hrefs) {
          discovered.add(href);
        }
      } catch {
        // Seed page failed — that's OK, it'll be caught by the main crawl test
      }
    }

    // Filter out already-tested pages, auth pages, API routes, and image URLs
    const linksToCheck = [...discovered].filter(path => {
      const cleanPath = path.split('?')[0];
      if (visited.has(cleanPath)) return false;
      if (AUTH_PAGES.has(cleanPath)) return false;
      if (cleanPath.startsWith('/api/')) return false;
      if (cleanPath.startsWith('/auth/')) return false;
      if (cleanPath.match(/\.(png|jpg|jpeg|gif|svg|ico|webp|pdf|xml|json|txt|css|js)$/i)) return false;
      visited.add(cleanPath);
      return true;
    });

    console.log(`\nDiscovered ${discovered.size} unique internal links from ${SEED_PAGES.length} seed pages`);
    console.log(`Checking ${linksToCheck.length} links (after filtering auth/api/assets)\n`);

    // Check each discovered link — parallelize in batches of 8 to keep the
    // wall clock under the 10-min test budget. Sequential with a 150ms delay
    // used to OOM at ~150+ links * 2-3s avg = 5-8 minutes per run.
    const LINK_BATCH = 8;
    for (let i = 0; i < linksToCheck.length; i += LINK_BATCH) {
      const slice = linksToCheck.slice(i, i + LINK_BATCH);
      const batch = await Promise.all(slice.map(path => checkPage(request, path, false)));
      for (const result of batch) {
        results.push(result);
        if (result.error) broken.push(result);
      }
    }

    printResults(results, broken, 'LINK FOLLOWER RESULTS');

    const unexpectedBroken = broken.filter(b => !isExpectedBroken(b.path));
    if (broken.length !== unexpectedBroken.length) {
      console.log(`Suppressed ${broken.length - unexpectedBroken.length} EXPECTED_BROKEN failures (see EXPECTED_BROKEN set in this file).`);
    }
    expect(
      unexpectedBroken.map(b => `${b.status ?? 'TIMEOUT'} ${b.path}: ${b.error}`),
      `${unexpectedBroken.length} unexpected broken links found`
    ).toHaveLength(0);
  });
});
