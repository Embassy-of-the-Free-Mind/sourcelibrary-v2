import { test, expect } from '@playwright/test';
import { measurePerf } from './perf';

test.describe('Gallery', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/gallery');
  });

  test.afterEach(async ({ page }, testInfo) => {
    await measurePerf(page, `gallery: ${testInfo.title}`);
  });

  test('gallery page loads with heading', async ({ page }) => {
    await expect(page.getByText('Image Gallery').first()).toBeVisible();
  });

  test('image grid loads with gallery cards', async ({ page }) => {
    // Gallery images link to /gallery/image/{id}
    const galleryLinks = page.locator('a[href*="/gallery/image/"]');
    await expect(galleryLinks.first()).toBeVisible({ timeout: 15_000 });
  });

  test('search input exists', async ({ page }) => {
    const searchInput = page.locator('input[type="search"], input[placeholder*="earch"], input[type="text"]');
    await expect(searchInput.first()).toBeVisible();
  });
});
