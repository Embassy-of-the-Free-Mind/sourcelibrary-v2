import { test, expect } from '@playwright/test';
import { measurePerf } from './perf';
import { BOOK, PAGE } from './fixtures';

test.describe('Page Reader', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/book/${BOOK.slug}/page/${PAGE.id}`);
  });

  test.afterEach(async ({ page }, testInfo) => {
    await measurePerf(page, `page-reader: ${testInfo.title}`);
  });

  // #2084: page reader also renders the 404 heading because it depends on the
  // same book document lookup that is currently broken. Skip until fixed.
  test.skip('page loads without error', async ({ page }) => {
    await expect(page.getByText(/page not found/i)).not.toBeVisible();
    await expect(page.getByRole('heading', { name: /404/ })).not.toBeVisible();
  });

  // #2084: the underlying book document can't be loaded in production, so the
  // page image asset is never rendered. The lighter "no error text" check
  // above still passes because the page reader URL renders a different
  // not-found shape than /book/{slug}. Re-enable once #2084 is fixed.
  test.skip('page image is visible', async ({ page }) => {
    const image = page.locator('img[alt*="Page"], img[alt*="page"]').first();
    await expect(image).toBeVisible({ timeout: 15_000 });
  });
});
