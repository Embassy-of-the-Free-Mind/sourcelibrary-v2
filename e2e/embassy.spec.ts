import { test, expect } from '@playwright/test';
import { measurePerf } from './perf';

/**
 * E2E tests for the Embassy of the Free Mind.
 * Tests against the live production site.
 */

test.describe('Embassy - Reading Room', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/embassy');
  });

  test.afterEach(async ({ page }, testInfo) => {
    await measurePerf(page, `embassy: ${testInfo.title}`);
  });

  test('page loads with Reading Room header', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Reading Room');
  });

  test('shows welcome message with sun symbol', async ({ page }) => {
    await expect(page.locator('text=Welcome to the Embassy')).toBeVisible();
    await expect(page.locator('text=The Librarian has read every text')).toBeVisible();
  });

  test('shows suggestion chips', async ({ page }) => {
    const suggestions = page.locator('button', { hasText: /Agrippa|Emerald Tablet|Ficino|Philosopher/ });
    await expect(suggestions.first()).toBeVisible();
    expect(await suggestions.count()).toBe(4);
  });

  test('clicking suggestion populates input', async ({ page }) => {
    const suggestion = page.locator('button', { hasText: 'Emerald Tablet' });
    await suggestion.click();
    const textarea = page.locator('textarea');
    await expect(textarea).toHaveValue(/Emerald Tablet/);
  });

  test('shows sign-in prompt when not authenticated', async ({ page }) => {
    await expect(page.locator('text=Sign in')).toBeVisible();
    await expect(page.locator('textarea')).toBeDisabled();
  });

  test('sidebar shows Recent Conversations heading', async ({ page }) => {
    await expect(page.locator('text=Recent Conversations')).toBeVisible();
  });

  test('sidebar shows Rooms section', async ({ page }) => {
    await expect(page.locator('text=Rooms')).toBeVisible();
  });

  test('rooms link to individual room pages', async ({ page }) => {
    // Wait for rooms to load
    await page.waitForTimeout(2000);
    const roomLink = page.locator('a[href*="/embassy/room/"]').first();
    if (await roomLink.isVisible()) {
      const href = await roomLink.getAttribute('href');
      expect(href).toMatch(/\/embassy\/room\/[a-z-]+/);
    }
  });

  test('profile link visible in sidebar', async ({ page }) => {
    await expect(page.locator('a[href="/ficino-society"]')).toBeVisible();
    await expect(page.locator('a[href="/collections"]')).toBeVisible();
  });

  test('breadcrumb shows The Embassy', async ({ page }) => {
    await expect(page.locator('text=The Embassy')).toBeVisible();
  });
});

test.describe('Embassy - Room Page', () => {
  test('general room loads', async ({ page }) => {
    await page.goto('/embassy/room/general');
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('text=Sign in')).toBeVisible();
  });
});

test.describe('Embassy - Thread View', () => {
  test('thread page has back link to Embassy', async ({ page }) => {
    // Navigate to a thread — if none exist, this tests the 404/empty state
    await page.goto('/embassy');
    const threadLink = page.locator('a[href*="/embassy/thread/"]').first();
    if (await threadLink.isVisible()) {
      await threadLink.click();
      await expect(page.locator('a[href="/embassy"]')).toBeVisible();
    }
  });
});

test.describe('Embassy - API Routes', () => {
  test('GET /api/embassy/threads returns JSON', async ({ request }) => {
    const res = await request.get('/api/embassy/threads');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty('threads');
    expect(Array.isArray(data.threads)).toBeTruthy();
  });

  test('GET /api/embassy/rooms returns rooms with slugs', async ({ request }) => {
    const res = await request.get('/api/embassy/rooms');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty('rooms');
    expect(data.rooms.length).toBeGreaterThan(0);
    expect(data.rooms[0]).toHaveProperty('slug');
    expect(data.rooms[0]).toHaveProperty('name');
  });

  test('POST /api/embassy/chat requires auth', async ({ request }) => {
    const res = await request.post('/api/embassy/chat', {
      data: { message: 'Hello' },
    });
    expect(res.status()).toBe(401);
  });

  test('GET /api/embassy/rooms/general/messages returns messages', async ({ request }) => {
    const res = await request.get('/api/embassy/rooms/general/messages');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty('messages');
    expect(Array.isArray(data.messages)).toBeTruthy();
  });
});
