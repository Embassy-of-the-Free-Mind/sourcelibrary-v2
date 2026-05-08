import { test, expect } from '@playwright/test';
import { measurePerf } from './perf';

/**
 * E2E tests for the BPH iframe — the three-page model + lockdown invariants.
 *
 * `bph.sourcelibrary.org` is EFM's embedded face of the Bibliotheca
 * Philosophica Hermetica. The iframe must feel native: no escapes off the
 * tenant subdomain, no orphan filter params making the URL bar lie about
 * what's filtered, no /embed/ prefix loss when the search page updates the URL.
 *
 * Tests run against the internal `/embed/bph/...` paths (the production proxy
 * rewrites `/`, `/catalog`, `/search` on the BPH subdomain to these — that
 * path is not exercised on a *.vercel.app preview, but the pages themselves
 * are identical regardless of host).
 */

const SEARCH_TIMEOUT = 45_000;

// The BPH default landing renders the unified catalogue shell. Since #1651,
// `view=books` and `view=catalog` are two display modes of the same page; the
// "All Books" heading is gone and the h2 is "Library Catalogue" for both.
const BPH_HEADING = 'Library Catalogue';

test.describe('BPH iframe — digital collection (/embed/bph)', () => {
  test('page renders the unified catalogue with cards', async ({ page }) => {
    await page.goto('/embed/bph');

    // Hero (and its h1) is suppressed on the unified catalogue views (#1653)
    // so partners can wrap the iframe with their own page chrome. The
    // "Library Catalogue" h2 is the top-of-page anchor for both modes.
    await expect(page.locator('h2', { hasText: BPH_HEADING }).first()).toBeVisible({ timeout: 15_000 });

    // Default mode renders the digitised+translated grid → book cards
    const bookCards = page.locator('a[href*="/book/"]');
    await expect(bookCards.first()).toBeVisible({ timeout: 15_000 });
    expect(await bookCards.count()).toBeGreaterThan(10);

    await measurePerf(page, 'bph collection: renders');
  });

  test('"Search within" filter updates URL with q= and stays on /embed/bph', async ({ page }) => {
    await page.goto('/embed/bph');
    await expect(page.locator('h2', { hasText: BPH_HEADING }).first()).toBeVisible({ timeout: 15_000 });

    const input = page.getByPlaceholder(/Search within/i);
    await input.fill('boehme');

    await expect(page).toHaveURL(/\/embed\/bph\?(.*&)?q=boehme/, { timeout: 5_000 });
    expect(page.url()).not.toContain('/bph/search');
    // /bph without the /embed/ prefix would be a leak (the URL-prefix routing
    // exists for non-tenant-subdomain consumers and would render with the full
    // SiteHeader, breaking the iframe seam).
    expect(page.url()).not.toMatch(/\.vercel\.app\/bph(\?|$)/);

    await measurePerf(page, 'bph collection: filter in place');
  });
});

test.describe('BPH iframe — catalog mode (/embed/bph?view=catalog)', () => {
  test('Library Catalogue table renders in "all" mode', async ({ page }) => {
    await page.goto('/embed/bph?view=catalog');

    await expect(page.locator('h2', { hasText: BPH_HEADING })).toBeVisible({ timeout: 15_000 });

    // "all" mode shows the catalogue browser table
    const rows = page.locator('table tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    expect(await rows.count()).toBeGreaterThan(10);

    await measurePerf(page, 'bph catalog: table renders');
  });

  test('cq= filter narrows the table in place', async ({ page }) => {
    await page.goto('/embed/bph?view=catalog&cq=boehme');

    await expect(page.locator('h2', { hasText: BPH_HEADING })).toBeVisible({ timeout: 15_000 });

    // Catalogue browser header reports "{N} works" once filtered
    const countBadge = page.locator('text=/\\d+ works/').first();
    await expect(countBadge).toBeVisible({ timeout: 10_000 });

    // URL preserves both view and cq, no orphan q
    expect(page.url()).toContain('view=catalog');
    expect(page.url()).toContain('cq=boehme');

    await measurePerf(page, 'bph catalog: filter in place');
  });
});

test.describe('BPH iframe — search (/embed/bph/search)', () => {
  test('search page loads with forceEmbedded — no global SiteHeader', async ({ page }) => {
    await page.goto('/embed/bph/search?q=boehme');

    // Search input visible
    const searchInput = page.getByPlaceholder(/search/i).first();
    await expect(searchInput).toBeVisible({ timeout: SEARCH_TIMEOUT });

    // SiteHeader's global nav items (Collections, Gallery, Browse, etc.) must
    // NOT be present in embed mode. "Sign in" is gated by auth state and isn't
    // reliable; the nav anchors are. Verified via negative test: visiting
    // /bph/search renders SiteHeader with these links; /embed/bph/search hides them.
    const collectionsNav = page.getByRole('navigation').getByRole('link', { name: 'Collections' });
    await expect(collectionsNav).toHaveCount(0);

    await measurePerf(page, 'bph search: embed mode renders');
  });

  test('URL stays on /embed/bph/search after first state change', async ({ page }) => {
    await page.goto('/embed/bph/search?q=boehme');

    // Wait for the first result to render so updateUrl has a chance to fire
    const catalogHeader = page.locator('text=/CATALOG MATCHES/i').first();
    await expect(catalogHeader).toBeVisible({ timeout: SEARCH_TIMEOUT });

    // Critical lockdown invariant: the page must not have stripped /embed/
    expect(page.url()).toContain('/embed/bph/search');
    expect(page.url()).not.toMatch(/\.vercel\.app\/bph\/search/);
  });

  test('catalog matches section renders for BPH catalog hits', async ({ page }) => {
    await page.goto('/embed/bph/search?q=rosicrucian');

    const catalogSection = page.locator('text=/CATALOG MATCHES/i').first();
    await expect(catalogSection).toBeVisible({ timeout: SEARCH_TIMEOUT });

    // "CATALOG ONLY" badge appears at least once (rosicrucian has ~389
    // catalog-only works as of this writing)
    const catalogBadge = page.locator('text=/CATALOG ONLY/i').first();
    await expect(catalogBadge).toBeVisible({ timeout: 10_000 });

    // "Open all N catalog matches" link present and stays in-tenant
    const openAll = page.locator('a', { hasText: /catalog matches/i }).first();
    await expect(openAll).toBeVisible();
    const href = await openAll.getAttribute('href');
    expect(href).toMatch(/^\/catalog\?cq=/);

    await measurePerf(page, 'bph search: catalog matches section');
  });

  test('no anchor escapes to sourcelibrary.org', async ({ page }) => {
    await page.goto('/embed/bph/search?q=boehme');
    await expect(page.locator('text=/CATALOG MATCHES/i').first()).toBeVisible({ timeout: SEARCH_TIMEOUT });

    // Lockdown invariant: every <a href> must be relative or a sibling tenant URL.
    // On a *.vercel.app preview there's no tenant subdomain — so every absolute
    // href that resolves to https://sourcelibrary.org/* is a leak. Relative hrefs
    // (`/book/...`, `/catalog/...`) are fine because they resolve against the
    // current host (which on bph.sourcelibrary.org keeps the user on-tenant).
    const hrefs = await page.locator('a[href]').evaluateAll(
      (els: HTMLAnchorElement[]) => els.map(a => a.getAttribute('href') || '')
    );
    const leaks = hrefs.filter(h =>
      /^https?:\/\/(www\.)?sourcelibrary\.org/i.test(h)
    );
    expect(leaks, `Found ${leaks.length} hardcoded sourcelibrary.org links: ${leaks.slice(0, 3).join(', ')}`).toHaveLength(0);
  });

  test('no Collection cards leak through search (cross-tenant guard)', async ({ page }) => {
    // Collections are SL-global content (Depth Psychology, Hermetica, etc.).
    // Showing them on bph.sourcelibrary.org/search is a cross-tenant leak.
    // The Hartmann query specifically surfaces "Depth Psychology" — easy
    // regression marker. Guard added in feedback round 2 (image #8).
    await page.goto('/embed/bph/search?q=Hartmann');
    await expect(page.locator('text=/CATALOG MATCHES/i').first()).toBeVisible({ timeout: SEARCH_TIMEOUT });

    // Search-result collection cards are <a href="/collections/{slug}"> with
    // a "{N} books" label. Anchors with that pattern indicate the lane is on.
    const collectionAnchors = page.locator('a[href^="/collections/"]');
    expect(await collectionAnchors.count()).toBe(0);

    // Also no "Depth Psychology" label anywhere (it's an SL-only collection).
    const dp = page.locator('text=/Depth Psychology/i');
    expect(await dp.count()).toBe(0);
  });
});

test.describe('BPH iframe — orphan param strip', () => {
  // Server-side redirect: visiting /embed/bph?cq=stale (a catalog filter on the
  // books view) must redirect to clean URL. Otherwise the URL bar shows a
  // filter that the visible page is silently ignoring.
  test('cq= on books view is stripped via redirect', async ({ page }) => {
    const response = await page.goto('/embed/bph?cq=stale');

    // Final URL has no cq=
    expect(page.url()).not.toContain('cq=stale');
    expect(page.url()).toMatch(/\/embed\/bph(\?|$)/);

    // Page still rendered
    await expect(page.locator('h2', { hasText: BPH_HEADING }).first()).toBeVisible({ timeout: 15_000 });

    // 307 (or 200 after follow) — Playwright follows redirects, so just sanity-check status
    expect([200, 307, 308]).toContain(response?.status() || 0);
  });

  test('q= on catalog view is stripped via redirect', async ({ page }) => {
    await page.goto('/embed/bph?view=catalog&q=stale');

    expect(page.url()).not.toContain('q=stale');
    expect(page.url()).toContain('view=catalog');

    await expect(page.locator('h2', { hasText: BPH_HEADING })).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('BPH iframe — catalog detail page', () => {
  test('loads with metadata for a real UBN', async ({ page, request }) => {
    // Pull a real UBN from the catalog API rather than hardcoding — the catalog
    // is editable and any specific UBN we pin could be deleted/renumbered.
    const apiRes = await request.get('/api/catalog/bph?q=boehme&limit=1');
    expect(apiRes.ok()).toBeTruthy();
    const json = await apiRes.json();
    const ubn = json.works?.[0]?.ubn;
    expect(ubn, 'catalog API returned no works for "boehme"').toBeTruthy();

    await page.goto(`/embed/bph/catalog/${ubn}`);

    // Detail page has the work's title as h1 (or close to it). Just verify
    // the page rendered something non-trivial — not a 404.
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
    expect(await page.locator('h1').first().textContent()).not.toMatch(/not found/i);

    await measurePerf(page, 'bph catalog detail: loads');
  });
});
