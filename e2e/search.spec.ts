import { test, expect } from '@playwright/test';
import { measurePerf } from './perf';
import { SEARCH } from './fixtures';

// Search is fully client-side rendered. It needs to hydrate JS, then call
// the search API. AI streaming (SSE) keeps the network active indefinitely.
// Use generous timeouts and wait for specific elements, not network state.
const SEARCH_TIMEOUT = 45_000;

test.describe('Search', () => {
  // Use a shared page context to avoid cold-start penalty on every test.
  // The first navigation primes the Vercel function + JS bundle cache.
  test('shows results for known query', async ({ page }) => {
    // Start the response listener before navigation
    const responsePromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/') && resp.url().includes('search') && resp.status() === 200,
      { timeout: SEARCH_TIMEOUT }
    );

    await page.goto(`/search?q=${SEARCH.query}`);
    await responsePromise;

    // Now wait for results to render
    const resultLinks = page.locator('a[href*="/book/"]');
    await expect(resultLinks.first()).toBeVisible({ timeout: 15_000 });
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

  test('mode tabs switch between Books and Index', async ({ page }) => {
    await page.goto(`/search?q=${SEARCH.query}`);

    // Wait for results heading (indicates search completed)
    const resultsHeading = page.getByRole('heading', { name: /results/i });
    await expect(resultsHeading).toBeVisible({ timeout: SEARCH_TIMEOUT });

    // Click "See all ... index entries" button to drill into index mode
    const seeAllIndex = page.getByRole('button', { name: /See all.*index/i });
    await expect(seeAllIndex).toBeVisible({ timeout: 15_000 });
    await seeAllIndex.click();

    // Verify drilled into index mode
    await expect(page).toHaveURL(/mode=index/i);
    await measurePerf(page, 'search: mode tabs switch');
  });
});
