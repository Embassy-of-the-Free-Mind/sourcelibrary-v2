import { test, expect } from '@playwright/test';

test.describe('Gallery', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/gallery');
  });

  test('gallery page loads with heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /image gallery/i })).toBeVisible();
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
