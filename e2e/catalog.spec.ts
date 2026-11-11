import { test, expect, type Page } from '@playwright/test';
import { measurePerf } from './perf';

/**
 * E2E tests for the main-site catalogue, /library (CatalogExplorer).
 * /catalog 308s here on the main site since #8247; partner hosts keep /catalog.
 * Tests against production (Vercel direct URL, bypassing Cloudflare).
 */

/** The stats band's "N works in the library", once the count-up has settled. */
async function libraryTotal(page: Page): Promise<number> {
  const band = page.getByRole('region', { name: 'What is in view' });
  await expect(band.getByText('works in the library')).toBeVisible({ timeout: 15_000 });
  const figure = band.getByText(/^\d[\d,]+$/).first();
  // The figure counts up from 0; wait until it is in the thousands.
  await expect(figure).toHaveText(/^\d{1,3}(,\d{3})+$/, { timeout: 10_000 });
  return parseInt(((await figure.textContent()) || '').replace(/,/g, ''));
}

test.describe('Catalog', () => {
  test.afterEach(async ({ page }, testInfo) => {
    await measurePerf(page, `catalog: ${testInfo.title}`);
  });

  test('/catalog redirects to /library', async ({ page }) => {
    await page.goto('/catalog');
    await expect(page).toHaveURL(/\/library(\?|$)/);
    await expect(page.getByRole('heading', { level: 1, name: 'The Library' })).toBeVisible();
  });

  test('page loads and shows book count', async ({ page }) => {
    await page.goto('/library');
    const count = await libraryTotal(page);
    // Should be thousands
    expect(count).toBeGreaterThan(1000);
    console.log(`Library loaded with ${count} works`);
  });

  test('list view renders book rows', async ({ page }) => {
    await page.goto('/library');
    await libraryTotal(page);

    // Default is grid view — explicitly toggle to list view to check the table.
    await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'List' }).click();
    const rows = page.locator('table tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
    expect(await rows.count()).toBeGreaterThan(10);
  });

  test('search filters results', async ({ page }) => {
    await page.goto('/library');
    await libraryTotal(page);

    // The catalogue's own box: the header also has a site-wide searchbox,
    // which navigates to /search instead of filtering (#6485).
    await page.getByRole('searchbox', { name: 'Search the catalogue' }).fill('Agrippa');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/[?&]q=agrippa/i);
    // The band switches to "N works found, of M"
    await expect(page.getByRole('region', { name: 'What is in view' }).getByText(/works? found, of \d[\d,]+/))
      .toBeVisible({ timeout: 15_000 });
  });

  test('sort changes order', async ({ page }) => {
    await page.goto('/library');
    await libraryTotal(page);

    await page.getByRole('combobox', { name: 'Sort' }).selectOption({ value: 'title' });
    await expect(page).toHaveURL(/sort=title/);
  });

  test('pagination works', async ({ page }) => {
    await page.goto('/library');
    await libraryTotal(page);

    const pager = page.getByRole('navigation', { name: 'Pagination' });
    const page2Button = pager.getByRole('button', { name: '2', exact: true });
    await expect(page2Button).toBeVisible({ timeout: 10_000 });
    await page2Button.click();
    await expect(page).toHaveURL(/page=2/);
  });

  test('time to interactive under 8s', async ({ page }) => {
    const start = Date.now();
    await page.goto('/library');
    await expect(page.getByRole('region', { name: 'What is in view' }).getByText('works in the library'))
      .toBeVisible({ timeout: 15_000 });
    // Default view is grid — assert on book cards rather than the (list-only) table.
    const cards = page.locator('#main-content a[href^="/book/"]');
    await expect(cards.first()).toBeVisible({ timeout: 5_000 });
    const tti = Date.now() - start;

    console.log(`Library TTI: ${tti}ms`);
    // Fail if the catalogue takes more than 8s to become interactive
    expect(tti).toBeLessThan(8000);
  });
});
