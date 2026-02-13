import { test, expect } from '@playwright/test';

test.describe('Navigation Flow', () => {
  test('homepage -> book detail -> page reader', async ({ page }) => {
    // 1. Start at homepage
    await page.goto('/');
    await expect(page).toHaveTitle(/Source Library/i);

    // 2. Click first book card
    const bookLink = page.locator('a[href*="/book/"]').first();
    await expect(bookLink).toBeVisible();
    await bookLink.click();

    // 3. Verify book detail page
    await expect(page).toHaveURL(/\/book\//);
    await expect(page.getByRole('heading').first()).toBeVisible();

    // 4. Click first page link (format: /book/{bookId}/page/{pageId})
    const pageLink = page.locator('a[href*="/page/"]').first();
    await expect(pageLink).toBeVisible();
    await pageLink.click();

    // 5. Verify page reader loaded (URL contains /page/)
    await expect(page).toHaveURL(/\/page\//);
    await expect(page.getByText(/page not found/i)).not.toBeVisible({ timeout: 15_000 });
  });
});
