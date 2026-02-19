import { test, expect } from '@playwright/test';
import { measurePerf } from './perf';
import { BOOK } from './fixtures';

test.describe('Navigation Flow', () => {
  test('homepage -> book detail -> page reader', async ({ page }) => {
    // 1. Start at homepage
    await page.goto('/');
    await expect(page).toHaveTitle(/Source Library/i);
    await measurePerf(page, 'nav-flow: homepage');

    // 2. Navigate to known featured book (instead of clicking random first book)
    await page.goto(`/book/${BOOK.id}`);

    // 3. Verify book detail page
    await expect(page).toHaveURL(/\/book\//);
    await expect(page.getByRole('heading', { name: /Musaeum hermeticum/i })).toBeVisible();
    await measurePerf(page, 'nav-flow: book detail');

    // 4. Click first page link (format: /book/{bookId}/page/{pageId})
    const pageLink = page.locator('a[href*="/page/"]').first();
    await expect(pageLink).toBeVisible();
    await pageLink.click();

    // 5. Verify page reader loaded (URL contains /page/)
    await expect(page).toHaveURL(/\/page\//);
    await expect(page.getByText(/page not found/i)).not.toBeVisible({ timeout: 15_000 });
    await measurePerf(page, 'nav-flow: page reader');
  });
});
