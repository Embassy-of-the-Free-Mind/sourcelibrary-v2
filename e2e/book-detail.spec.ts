import { test, expect } from '@playwright/test';
import { measurePerf } from './perf';
import { BOOK } from './fixtures';

test.describe('Book Detail', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/book/${BOOK.id}`);
  });

  test.afterEach(async ({ page }, testInfo) => {
    await measurePerf(page, `book-detail: ${testInfo.title}`);
  });

  test('book title heading is visible', async ({ page }) => {
    const heading = page.getByRole('heading', { name: /The Hermetic Museum/i });
    await expect(heading).toBeVisible();
  });

  test('language metadata is visible', async ({ page }) => {
    // Wait for page to fully load beyond Suspense boundary
    await expect(page.getByRole('heading', { name: /The Hermetic Museum/i })).toBeVisible();
    await expect(page.getByTestId('language-metadata')).toContainText(BOOK.language);
  });

  test('pages grid loads with links', async ({ page }) => {
    const pageLinks = page.locator('a[href*="/page/"]');
    await expect(pageLinks.first()).toBeVisible();
    expect(await pageLinks.count()).toBeGreaterThan(0);
  });

  test('about section is present', async ({ page }) => {
    const aboutSection = page.getByText(/about this book/i)
      .or(page.getByText(/reading summary/i))
      .or(page.getByText(/overview/i));
    await expect(aboutSection.first()).toBeVisible();
  });
});
