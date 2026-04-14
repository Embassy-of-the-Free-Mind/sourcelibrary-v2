import { test, expect } from '@playwright/test';
import { measurePerf } from './perf';

/**
 * E2E tests for the Reading Room (formerly Embassy of the Free Mind).
 * Tests against the live production site.
 */

test.describe('Reading Room', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/reading-room');
  });

  test.afterEach(async ({ page }, testInfo) => {
    await measurePerf(page, `reading-room: ${testInfo.title}`);
  });

  test('page loads with Reading Room heading', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Reading Room');
  });

  test('shows librarian description', async ({ page }) => {
    await expect(page.getByText('The Librarian searches the collection')).toBeVisible();
  });

  test('shows suggestion chips', async ({ page }) => {
    const suggestions = page.locator('button', {
      hasText: /world soul|philosopher.*stone|Agrippa|Kabbalah/,
    });
    await expect(suggestions.first()).toBeVisible();
    expect(await suggestions.count()).toBe(4);
  });

  test('clicking suggestion populates input', async ({ page }) => {
    const suggestion = page.locator('button', { hasText: 'world soul' });
    await suggestion.click();
    const textarea = page.locator('textarea');
    await expect(textarea).toHaveValue(/world soul/);
  });

  test('shows sign-in prompt when not authenticated', async ({ page }) => {
    await expect(page.locator('textarea')).toBeDisabled();
    await expect(page.locator('textarea')).toHaveAttribute('placeholder', /Sign in/);
  });

  test('shows Recent tab', async ({ page }) => {
    await expect(page.locator('button', { hasText: 'Recent' })).toBeVisible();
  });
});

test.describe('Reading Room - Room Page', () => {
  test('general room loads', async ({ page }) => {
    await page.goto('/reading-room/room/general');
    await expect(page.locator('h1')).toBeVisible();
  });
});

test.describe('Reading Room - Thread View', () => {
  test('thread page has back link', async ({ page }) => {
    await page.goto('/reading-room');
    const threadLink = page.locator('a[href*="/reading-room/thread/"]').first();
    if (await threadLink.isVisible()) {
      await threadLink.click();
      await expect(page.locator('a[href="/reading-room"]')).toBeVisible();
    }
  });
});

test.describe('Reading Room - API Routes', () => {
  test('GET /api/embassy/threads returns JSON', async ({ request }) => {
    const res = await request.get('/api/embassy/threads');
    if (res.status() === 429) { test.skip(); return; }
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty('threads');
    expect(Array.isArray(data.threads)).toBeTruthy();
  });

  test('GET /api/embassy/rooms returns rooms with slugs', async ({ request }) => {
    const res = await request.get('/api/embassy/rooms');
    if (res.status() === 429) { test.skip(); return; }
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
    expect([401, 429]).toContain(res.status());
  });

  test('GET /api/embassy/rooms/general/messages returns messages', async ({ request }) => {
    const res = await request.get('/api/embassy/rooms/general/messages');
    if (res.status() === 429) { test.skip(); return; }
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty('messages');
    expect(Array.isArray(data.messages)).toBeTruthy();
  });
});
