import { test, expect } from '@playwright/test';
import { measurePerf } from './perf';
import { SEARCH } from './fixtures';

// Search is fully client-side rendered. It needs to hydrate JS, then call
// the search API. AI streaming (SSE) keeps the network active indefinitely.
// Use generous timeouts and wait for specific elements, not network state.
const SEARCH_TIMEOUT = 45_000;

test.describe('Search', () => {
  // Run search tests serially — they share the same search endpoint
  // and parallel requests trigger rate limiting (429)
  test.describe.configure({ mode: 'serial' });

  test('shows results for known query', async ({ page }) => {
    await page.goto(`/search?q=${SEARCH.query}`);

    // Wait for results to load (can be slow on cold starts)
    const resultLinks = page.locator('a[href*="/book/"]');
    await expect(resultLinks.first()).toBeVisible({ timeout: SEARCH_TIMEOUT });
    expect(await resultLinks.count()).toBeGreaterThanOrEqual(SEARCH.minResults);

    // Also verify result cards link to books (combined to avoid duplicate search requests)
    const href = await resultLinks.first().getAttribute('href');
    expect(href).toMatch(/\/book\//);
    await measurePerf(page, 'search: shows results for known query');
  });

  test('search results heading appears', async ({ page }) => {
    await page.goto(`/search?q=${SEARCH.query}`);

    // Wait for results heading (indicates search completed and found results)
    // The heading shows "{N} results" in the unified view
    const resultsHeading = page.getByRole('heading', { name: /results/i });
    await expect(resultsHeading).toBeVisible({ timeout: SEARCH_TIMEOUT });
    await measurePerf(page, 'search: results heading appears');
  });
});
