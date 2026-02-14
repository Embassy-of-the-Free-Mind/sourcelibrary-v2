import { test, expect } from '@playwright/test';
import { measurePerf } from './perf';
import { BOOK, PAGE } from './fixtures';

test.describe('Page Reader', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/book/${BOOK.id}/page/${PAGE.id}`);
  });

  test.afterEach(async ({ page }, testInfo) => {
    await measurePerf(page, `page-reader: ${testInfo.title}`);
  });

  test('page loads without error', async ({ page }) => {
    await expect(page.getByText(/page not found/i)).not.toBeVisible();
    await expect(page.getByRole('heading', { name: /404/ })).not.toBeVisible();
  });

  test('page image is visible', async ({ page }) => {
    const image = page.locator('img[alt*="Page"], img[alt*="page"]').first();
    await expect(image).toBeVisible({ timeout: 15_000 });
  });
});
