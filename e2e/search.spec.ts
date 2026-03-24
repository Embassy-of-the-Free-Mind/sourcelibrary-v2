import { test, expect } from '@playwright/test';
import { measurePerf } from './perf';
import { SEARCH } from './fixtures';

// Search is fully client-side rendered. It needs to:
// 1. Download and hydrate JavaScript
// 2. Read query from URL params
// 3. Fetch filter options (languages, categories, collections)
// 4. Call the search API
// 5. AI streaming keeps a SSE connection open (so networkidle never fires)
// This can take 30s+ on cold starts from GitHub Actions.
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

    // Wait for results to appear
    const firstResult = page.locator('a[href*="/book/"]').first();
    await expect(firstResult).toBeVisible({ timeout: SEARCH_TIMEOUT });
    const href = await firstResult.getAttribute('href');
    expect(href).toMatch(/\/book\//);
    await measurePerf(page, 'search: result cards link to books');
  });

  test('mode tabs switch between Books and Index', async ({ page }) => {
    await page.goto(`/search?q=${SEARCH.query}`);

    // Wait for results heading to appear
    const resultsHeading = page.getByRole('heading', { name: /results/i });
    await expect(resultsHeading).toBeVisible({ timeout: SEARCH_TIMEOUT });

    // Click "See all ... index entries" button to drill into index mode
    const seeAllIndex = page.getByRole('button', { name: /See all.*index/i });
    await expect(seeAllIndex).toBeVisible({ timeout: SEARCH_TIMEOUT });
    await seeAllIndex.click();

    // Verify drilled into index mode
    await expect(page).toHaveURL(/mode=index/i);
    await measurePerf(page, 'search: mode tabs switch');
  });
});
