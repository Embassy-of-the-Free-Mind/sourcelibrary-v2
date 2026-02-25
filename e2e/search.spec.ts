import { test, expect } from '@playwright/test';
import { measurePerf } from './perf';
import { SEARCH } from './fixtures';

test.describe('Search', () => {
  test('shows results for known query', async ({ page }) => {
    await page.goto(`/search?q=${SEARCH.query}`);

    // Wait for results to load (can be slow on cold starts)
    const resultLinks = page.locator('a[href*="/book/"]');
    await expect(resultLinks.first()).toBeVisible({ timeout: 20000 });
    expect(await resultLinks.count()).toBeGreaterThanOrEqual(SEARCH.minResults);
    await measurePerf(page, 'search: shows results for known query');
  });

  test('result cards link to books', async ({ page }) => {
    await page.goto(`/search?q=${SEARCH.query}`);

    // Wait for results to load
    await expect(page.getByText('Searching...')).not.toBeVisible({ timeout: 15000 });

    const firstResult = page.locator('a[href*="/book/"]').first();
    await expect(firstResult).toBeVisible();
    const href = await firstResult.getAttribute('href');
    expect(href).toMatch(/\/book\//);
    await measurePerf(page, 'search: result cards link to books');
  });

  test('mode tabs switch between Books and Index', async ({ page }) => {
    await page.goto(`/search?q=${SEARCH.query}`);

    // Wait for results to load
    const resultsHeading = page.getByRole('heading', { name: /results/i });
    await expect(resultsHeading).toBeVisible({ timeout: 20000 });

    // Click "See all ... index entries" button to drill into index mode
    const seeAllIndex = page.getByRole('button', { name: /See all.*index/i });
    await expect(seeAllIndex).toBeVisible({ timeout: 10000 });
    await seeAllIndex.click();

    // Verify drilled into index mode
    await expect(page).toHaveURL(/mode=index/i);
    await measurePerf(page, 'search: mode tabs switch');
  });
});
