import { test, expect } from '@playwright/test';
import { measurePerf } from './perf';

test.describe('Homepage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test.afterEach(async ({ page }, testInfo) => {
    await measurePerf(page, `homepage: ${testInfo.title}`);
  });

  test('page title contains Source Library', async ({ page }) => {
    await expect(page).toHaveTitle(/Source Library/i);
  });

  test('hero section renders', async ({ page }) => {
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('book cards appear with links', async ({ page }) => {
    const bookLinks = page.locator('a[href*="/book/"]');
    await expect(bookLinks.first()).toBeVisible();
    expect(await bookLinks.count()).toBeGreaterThan(0);
  });

  test('search input exists', async ({ page }) => {
    const searchInput = page.locator('input[type="search"], input[placeholder*="earch"]');
    await expect(searchInput.first()).toBeVisible();
  });
});
