import { test, expect } from '@playwright/test';
import { measurePerf } from './perf';

/**
 * E2E tests for the Catalog page.
 * Tests against production (Vercel direct URL, bypassing Cloudflare).
 */

test.describe('Catalog', () => {
  test.afterEach(async ({ page }, testInfo) => {
    await measurePerf(page, `catalog: ${testInfo.title}`);
  });

  test('page loads and shows book count', async ({ page }) => {
    // SSR provides initial data — no client-side API call on default load.
    // Just verify the page renders with book count from server props.
    await page.goto('/catalog');

    const countText = page.locator('text=/\\d[\\d,]+ books/');
    await expect(countText).toBeVisible({ timeout: 15_000 });

    // Verify reasonable book count (should be thousands)
    const text = await countText.textContent();
    const count = parseInt((text || '').replace(/,/g, ''));
    expect(count).toBeGreaterThan(1000);
    console.log(`Catalog loaded with ${count} books (SSR)`);
  });

  test('list view renders book rows', async ({ page }) => {
    await page.goto('/catalog');
    await expect(page.locator('text=/\\d[\\d,]+ books/')).toBeVisible({ timeout: 15_000 });

    // Default is list view — should have table rows
    const rows = page.locator('table tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 5_000 });
    expect(await rows.count()).toBeGreaterThan(10);
  });

  test('search filters results', async ({ page }) => {
    await page.goto('/catalog');
    await expect(page.locator('text=/\\d[\\d,]+ books/')).toBeVisible({ timeout: 15_000 });

    await page.fill('input[placeholder*="Search"]', 'Agrippa');
    // Should show filtered count ("N of M books")
    await expect(page.locator('text=/\\d+ of \\d[\\d,]+ books/')).toBeVisible({ timeout: 5_000 });
  });

  test('sort changes order', async ({ page }) => {
    await page.goto('/catalog');
    await expect(page.locator('text=/\\d[\\d,]+ books/')).toBeVisible({ timeout: 15_000 });

    await page.selectOption('select', { value: 'title' });
    await expect(page).toHaveURL(/sort=title/);
  });

  test('pagination works', async ({ page }) => {
    await page.goto('/catalog');
    await expect(page.locator('text=/\\d[\\d,]+ books/')).toBeVisible({ timeout: 15_000 });

    const page2Button = page.locator('button', { hasText: '2' }).first();
    await expect(page2Button).toBeVisible({ timeout: 5_000 });
    await page2Button.click();
    await expect(page).toHaveURL(/page=2/);
  });

  test('time to interactive under 8s', async ({ page }) => {
    const start = Date.now();
    await page.goto('/catalog');
    await expect(page.locator('text=/\\d[\\d,]+ books/')).toBeVisible({ timeout: 15_000 });
    const rows = page.locator('table tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 5_000 });
    const tti = Date.now() - start;

    console.log(`Catalog TTI: ${tti}ms`);
    // Fail if catalog takes more than 8s to become interactive
    expect(tti).toBeLessThan(8000);
  });
});
