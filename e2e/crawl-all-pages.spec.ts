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
  '/curated',
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
  '/founding-donors',
  '/fulldata',
  '/gallery',
  '/gallery/collections',
  '/gallery/curate',
  '/gallery/review',
  '/hieroglyphs',
  '/jobs',
  '/languages',
  '/libraries',
  '/press-release',
  '/privacy',
  '/processing',
  '/qa',
  '/reading-history',
  '/research',
  '/research/atlas',
  '/research/concept-diffusion',
  '/research/image-atlas',
  '/research/image-pixplot',
  '/research/thumbnail-compare',
  '/research/translation-lag',
  '/rithmomachia',
  '/rithmomachia/guide',
  '/rithmomachia/scenarios',
  '/roadmap',
  '/scan',
  '/scan/auto',
  '/scan/opencv',
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

// Dynamic pages with known-good sample slugs
const DYNAMIC_PAGES = [
  '/book/the-hermetic-museum-various-sendivogius',
  '/collections/alchemy',
  '/collections/classical-philosophy',
  '/collections/hermetica',
  '/collections/kabbalah',
  '/collections/rosicrucianism',
  '/collections/astrology',
  '/browse/authors/A',
  '/browse/authors/F',
  '/browse/titles/A',
  '/browse/years/1500s',
  '/libraries/internet-archive',
  '/languages/latin',
  '/languages/german',
  '/search?q=alchemy',
  '/search?q=Ficino',
  '/author/Marsilio-Ficino',
  '/author/Paracelsus',
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

// Pages that require auth — expect redirect, not 200
const AUTH_PAGES = new Set([
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
]);

interface PageResult {
  path: string;
  status: number | null;
  error: string | null;
  loadTimeMs: number;
}

test.describe('Full site crawl', () => {
  // Increase timeout for the full crawl
  test.setTimeout(600_000); // 10 minutes

  test('crawl all pages and report broken ones', async ({ page, request }) => {
    const results: PageResult[] = [];
    const broken: PageResult[] = [];

    for (const path of ALL_PAGES) {
      const isAuth = AUTH_PAGES.has(path.split('?')[0]);
      const start = Date.now();

      try {
        // Use request context for speed — no JS execution needed for status check
        const response = await request.get(path, { timeout: 30_000 });
        const status = response.status();
        const elapsed = Date.now() - start;

        let error: string | null = null;

        if (isAuth) {
          // Auth pages might redirect (302/307) or return 401/403 — that's fine
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

        const result: PageResult = { path, status, error, loadTimeMs: elapsed };
        results.push(result);
        if (error) broken.push(result);

      } catch (err: any) {
        const elapsed = Date.now() - start;
        const result: PageResult = {
          path,
          status: null,
          error: `Request failed: ${err.message?.slice(0, 100)}`,
          loadTimeMs: elapsed,
        };
        results.push(result);
        broken.push(result);
      }

      // Small delay to avoid hammering the server
      await new Promise(r => setTimeout(r, 200));
    }

    // Print summary
    console.log('\n========== CRAWL RESULTS ==========');
    console.log(`Total pages tested: ${results.length}`);
    console.log(`Passed: ${results.length - broken.length}`);
    console.log(`Broken: ${broken.length}`);

    if (broken.length > 0) {
      console.log('\n--- BROKEN PAGES ---');
      for (const b of broken) {
        console.log(`  ${b.status ?? 'TIMEOUT'} | ${b.path} | ${b.error} (${b.loadTimeMs}ms)`);
      }
    }

    // Also report slow pages (>10s)
    const slow = results.filter(r => r.loadTimeMs > 10_000 && !r.error);
    if (slow.length > 0) {
      console.log('\n--- SLOW PAGES (>10s) ---');
      for (const s of slow) {
        console.log(`  ${s.loadTimeMs}ms | ${s.path}`);
      }
    }

    console.log('\n====================================\n');

    // Fail the test if any pages are broken
    expect(
      broken.map(b => `${b.status ?? 'TIMEOUT'} ${b.path}: ${b.error}`),
      `${broken.length} broken pages found`
    ).toHaveLength(0);
  });
});
