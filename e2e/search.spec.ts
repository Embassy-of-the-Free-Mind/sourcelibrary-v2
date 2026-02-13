import { test, expect } from '@playwright/test';
import { SEARCH } from './fixtures';

test.describe('Search', () => {
  test('shows results for known query', async ({ page }) => {
    await page.goto(`/search?q=${SEARCH.query}`);

    // Wait for results to load (can be slow on cold starts)
    const resultLinks = page.locator('a[href*="/book/"]');
    await expect(resultLinks.first()).toBeVisible({ timeout: 20_000 });
    expect(await resultLinks.count()).toBeGreaterThanOrEqual(SEARCH.minResults);
  });

  test('result cards link to books', async ({ page }) => {
    await page.goto(`/search?q=${SEARCH.query}`);

    // Wait for results to load
    await expect(page.getByText('Searching...')).not.toBeVisible({ timeout: 15_000 });

    const firstResult = page.locator('a[href*="/book/"]').first();
    await expect(firstResult).toBeVisible();
    const href = await firstResult.getAttribute('href');
    expect(href).toMatch(/\/book\//);
  });

  test('mode tabs switch between Books and Index', async ({ page }) => {
    await page.goto(`/search?q=${SEARCH.query}`);

    // Click the Index tab button
    const indexTab = page.getByRole('button', { name: /index/i });
    await expect(indexTab).toBeVisible();
    await indexTab.click();

    // URL should update to reflect mode change
    await expect(page).toHaveURL(/mode=index|tab=index|type=index/i);
  });
});
