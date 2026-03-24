import { test, expect } from '@playwright/test';
import { measurePerf } from './perf';
import { SEARCH } from './fixtures';

// Search is fully client-side rendered. It needs to hydrate JS, then call
// the search API. AI streaming (SSE) keeps the network active indefinitely.
// Use generous timeouts and wait for specific elements, not network state.
const SEARCH_TIMEOUT = 45_000;

test.describe('Search', () => {
  test('shows results for known query', async ({ page }) => {
    await page.goto(`/search?q=${SEARCH.query}`);

    // Wait for results to load (can be slow on cold starts)
    const resultLinks = page.locator('a[href*="/book/"]');
    await expect(resultLinks.first()).toBeVisible({ timeout: SEARCH_TIMEOUT });
    expect(await resultLinks.count()).toBeGreaterThanOrEqual(SEARCH.minResults);
    await measurePerf(page, 'search: shows results for known query');
  });

  test('result cards link to books', async ({ page }) => {
    await page.goto(`/search?q=${SEARCH.query}`);

    // Wait for book result links to appear
    const firstResult = page.locator('a[href*="/book/"]').first();
    await expect(firstResult).toBeVisible({ timeout: SEARCH_TIMEOUT });
    const href = await firstResult.getAttribute('href');
    expect(href).toMatch(/\/book\//);
    await measurePerf(page, 'search: result cards link to books');
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
