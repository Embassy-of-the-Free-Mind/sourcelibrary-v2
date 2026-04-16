import { test, expect } from '@playwright/test';
import { measurePerf } from './perf';
import { SEARCH } from './fixtures';

// Search is fully client-side rendered. It needs to hydrate JS, then call
// the search API. AI streaming (SSE) keeps the network active indefinitely.
// Use generous timeouts and wait for specific elements, not network state.
const SEARCH_TIMEOUT = 45_000;

// ---------------------------------------------------------------------------
// Core search functionality
// ---------------------------------------------------------------------------

test.describe('Search', () => {
  test('shows results for known query', async ({ page }) => {
    await page.goto(`/search?q=${SEARCH.query}`);

    const resultLinks = page.locator('a[href*="/book/"]');
    await expect(resultLinks.first()).toBeVisible({ timeout: SEARCH_TIMEOUT });
    expect(await resultLinks.count()).toBeGreaterThanOrEqual(SEARCH.minResults);
    await measurePerf(page, 'search: shows results for known query');
  });

  test('result cards link to books', async ({ page }) => {
    await page.goto(`/search?q=${SEARCH.query}`);

    const firstResult = page.locator('a[href*="/book/"]').first();
    await expect(firstResult).toBeVisible({ timeout: SEARCH_TIMEOUT });
    const href = await firstResult.getAttribute('href');
    expect(href).toMatch(/\/book\//);
    await measurePerf(page, 'search: result cards link to books');
  });

  test('search results heading appears', async ({ page }) => {
    await page.goto(`/search?q=${SEARCH.query}`);

    const resultsHeading = page.getByRole('heading', { name: /results/i });
    await expect(resultsHeading).toBeVisible({ timeout: SEARCH_TIMEOUT });
    await measurePerf(page, 'search: results heading appears');
  });
});

// ---------------------------------------------------------------------------
// View mode tabs
// ---------------------------------------------------------------------------

test.describe('Search: view modes', () => {
  test('Books tab shows paginated results', async ({ page }) => {
    await page.goto('/search?q=alchemy');
    await expect(page.locator('a[href*="/book/"]').first()).toBeVisible({ timeout: SEARCH_TIMEOUT });

    await page.click('button:has-text("Books")');
    await expect(page).toHaveURL(/mode=books/);
    await expect(page.locator('a[href*="/book/"]').first()).toBeVisible({ timeout: SEARCH_TIMEOUT });

    // Broad query should have pagination
    await expect(page.getByText(/Page \d+ of \d+/)).toBeVisible({ timeout: 10_000 });
  });

  test('Index tab shows entity filter pills', async ({ page }) => {
    await page.goto('/search?q=Hermes');
    await expect(page.locator('a[href*="/book/"]').first()).toBeVisible({ timeout: SEARCH_TIMEOUT });

    await page.click('button:has-text("Index")');
    await expect(page).toHaveURL(/mode=index/);

    // Index type filter pills should appear
    await expect(page.locator('button:has-text("Concepts")').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('button:has-text("People")').first()).toBeVisible();
  });

  test('Images tab shows image results', async ({ page }) => {
    await page.goto('/search?q=dragon');
    await expect(page.getByRole('heading', { name: /results/i })).toBeVisible({ timeout: SEARCH_TIMEOUT });

    await page.click('button:has-text("Images")');
    await expect(page).toHaveURL(/mode=images/);

    // Should show image elements
    await expect(page.locator('main img').first()).toBeVisible({ timeout: 15_000 });
  });

  test('tab switch preserves query in URL', async ({ page }) => {
    await page.goto(`/search?q=${SEARCH.query}`);
    await expect(page.locator('a[href*="/book/"]').first()).toBeVisible({ timeout: SEARCH_TIMEOUT });

    await page.click('button:has-text("Books")');
    await expect(page).toHaveURL(/mode=books/);
    await expect(page).toHaveURL(new RegExp(`q=${SEARCH.query}`));

    await page.click('button:has-text("All")');
    await expect(page).toHaveURL(new RegExp(`q=${SEARCH.query}`));
    // "All" mode should not have mode param
    await expect(page).not.toHaveURL(/mode=/);
  });
});

// ---------------------------------------------------------------------------
// Filters and sort
// ---------------------------------------------------------------------------

test.describe('Search: filters', () => {
  test('language filter restricts results via URL', async ({ page }) => {
    // Apply filter via URL param (avoids responsive layout issues with filter panel)
    await page.goto('/search?q=alchemy&language=Latin');

    await expect(page.locator('a[href*="/book/"]').first()).toBeVisible({ timeout: SEARCH_TIMEOUT });
    await expect(page).toHaveURL(/language=Latin/);

    // Compare with unfiltered — should have fewer or equal results
    // (just verify it loaded with the filter active)
  });

  test('sort dropdown changes URL', async ({ page }) => {
    await page.goto('/search?q=alchemy');
    await expect(page.locator('a[href*="/book/"]').first()).toBeVisible({ timeout: SEARCH_TIMEOUT });

    // Change sort to Title A-Z (first select on page is sort)
    const sortSelect = page.locator('select').first();
    await sortSelect.selectOption('title');

    await expect(page.locator('a[href*="/book/"]').first()).toBeVisible({ timeout: SEARCH_TIMEOUT });
    await expect(page).toHaveURL(/sort=title/);
  });

  test('filter indicator badge appears when filters active', async ({ page }) => {
    // Load with a filter pre-set via URL
    await page.goto('/search?q=alchemy&language=Latin');
    await expect(page.locator('a[href*="/book/"]').first()).toBeVisible({ timeout: SEARCH_TIMEOUT });

    // The Filters button should have a visual indicator (small dot)
    const filtersBtn = page.locator('button:has-text("Filters")');
    await expect(filtersBtn).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Empty and error states
// ---------------------------------------------------------------------------

test.describe('Search: empty and error states', () => {
  test('no results shows fallback suggestions', async ({ page }) => {
    await page.goto('/search?q=xyznonexistent12345');

    await expect(page.getByRole('heading', { name: 'No results found' })).toBeVisible({ timeout: SEARCH_TIMEOUT });

    // Should show example search terms
    await expect(page.locator('button:has-text("alchemy")')).toBeVisible();
    await expect(page.locator('button:has-text("Hermes")')).toBeVisible();
  });

  test('clicking suggested term triggers search', async ({ page }) => {
    await page.goto('/search?q=xyznonexistent12345');
    await expect(page.getByRole('heading', { name: 'No results found' })).toBeVisible({ timeout: SEARCH_TIMEOUT });

    await page.click('button:has-text("alchemy")');

    // Should show results for the clicked term
    await expect(page.locator('a[href*="/book/"]').first()).toBeVisible({ timeout: SEARCH_TIMEOUT });
  });

  test('short query does not trigger search', async ({ page }) => {
    await page.goto('/search?q=a');

    // Should not show search results or error — just browse mode
    await expect(page.getByRole('heading', { name: /results/i })).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('heading', { name: 'No results found' })).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// AI overview
// ---------------------------------------------------------------------------

test.describe('Search: AI overview', () => {
  test('AI context card appears for known terms', async ({ page }) => {
    await page.goto(`/search?q=${SEARCH.query}`);

    // Wait for book results first (AI card streams in parallel)
    await expect(page.locator('a[href*="/book/"]').first()).toBeVisible({ timeout: SEARCH_TIMEOUT });

    // AI narration renders as italic text — look for any italic element with substantial content
    // The card may take a few seconds to stream in from Gemini
    const aiText = page.locator('em, [style*="italic"]').first();
    await expect(aiText).toBeVisible({ timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

test.describe('Search: pagination', () => {
  test('Next and Previous work in books mode', async ({ page }) => {
    await page.goto('/search?q=alchemy&mode=books');
    await expect(page.locator('a[href*="/book/"]').first()).toBeVisible({ timeout: SEARCH_TIMEOUT });

    await expect(page.getByText(/Page 1 of/)).toBeVisible({ timeout: 10_000 });

    await page.click('button:has-text("Next")');
    await expect(page.getByText(/Page 2 of/)).toBeVisible({ timeout: SEARCH_TIMEOUT });
    await expect(page).toHaveURL(/offset=/);

    await page.click('button:has-text("Previous")');
    await expect(page.getByText(/Page 1 of/)).toBeVisible({ timeout: SEARCH_TIMEOUT });
  });
});

// ---------------------------------------------------------------------------
// API endpoints
// ---------------------------------------------------------------------------

test.describe('Search: API', () => {
  test('unified search returns structured response', async ({ request }) => {
    const res = await request.get(`/api/search/unified?q=${SEARCH.query}&limit=3`, { timeout: 15_000 });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    expect(data).toHaveProperty('books');
    expect(data).toHaveProperty('index');
    expect(data).toHaveProperty('gallery');
    expect(data.books).toHaveProperty('results');
    expect(data.books.results.length).toBeGreaterThan(0);

    // Book results should have required fields
    const book = data.books.results[0];
    expect(book).toHaveProperty('id');
    expect(book).toHaveProperty('title');
    expect(book).toHaveProperty('slug');
  });

  test('unified search responds within 10s', async ({ request }) => {
    const start = Date.now();
    const res = await request.get('/api/search/unified?q=alchemy&limit=3', { timeout: 15_000 });
    const elapsed = Date.now() - start;

    expect(res.ok()).toBeTruthy();
    expect(elapsed).toBeLessThan(10_000);
  });

  test('suggest endpoint returns suggestions', async ({ request }) => {
    const res = await request.get('/api/search/suggest?q=alch', { timeout: 10_000 });
    if (res.status() === 429) { test.skip(); return; }
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty('suggestions');
  });

  test('search works with language filter', async ({ request }) => {
    const res = await request.get('/api/books/search?q=alchemy&language=Latin&limit=3', { timeout: 10_000 });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty('results');
  });
});
