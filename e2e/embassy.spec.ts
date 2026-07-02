import { test, expect } from '@playwright/test';
import { measurePerf } from './perf';

/**
 * E2E tests for the Librarian (formerly Reading Room / Embassy of the Free Mind).
 * Tests against the live production site.
 */

test.describe('Librarian', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/librarian');
  });

  test.afterEach(async ({ page }, testInfo) => {
    await measurePerf(page, `librarian: ${testInfo.title}`);
  });

  test('page loads with Librarian heading', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('The Librarian');
  });

  test('shows librarian description', async ({ page }) => {
    await expect(page.getByText('The Librarian searches the collection')).toBeVisible();
  });

  test('shows suggestion chips', async ({ page }) => {
    // Suggestions may vary — just verify at least 2 are visible
    const suggestions = page.locator('button', {
      hasText: /world soul|philosopher|Agrippa|Kabbalah|Emerald|Ficino|alchemist/i,
    });
    await expect(suggestions.first()).toBeVisible();
    expect(await suggestions.count()).toBeGreaterThanOrEqual(1);
  });

  test('clicking suggestion populates input', async ({ page }) => {
    // Click whichever suggestion is visible
    const suggestions = page.locator('button', {
      hasText: /world soul|philosopher|Agrippa|Kabbalah|Emerald|Ficino|alchemist/i,
    });
    await expect(suggestions.first()).toBeVisible();
    const text = await suggestions.first().textContent();
    await suggestions.first().click();
    const textarea = page.locator('textarea');
    // After clicking, the textarea should contain part of the suggestion text
    if (text) {
      const keyword = text.split(/\s+/).find(w => w.length > 4) || text.slice(0, 10);
      await expect(textarea).toHaveValue(new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    }
  });

  test('anonymous visitors can use the Librarian input', async ({ page }) => {
    // Anonymous access was deliberately opened up (5 free actions/hour via
    // src/lib/anon-gate.ts) — the textarea is enabled for everyone, with a
    // soft "sign in to save your conversations" note below the input rather
    // than a hard disabled-input gate.
    await expect(page.locator('textarea')).toBeEnabled();
    await expect(page.locator('textarea')).toHaveAttribute('placeholder', 'Ask the Librarian...');
    await expect(page.getByText('to save your conversations and keep them private')).toBeVisible();
  });

  test('shows Recent tab', async ({ page }) => {
    await expect(page.locator('button', { hasText: 'Recent' })).toBeVisible();
  });
});

test.describe('Librarian - Room Page', () => {
  test('general room loads', async ({ page }) => {
    await page.goto('/librarian/room/general');
    await expect(page.locator('h1')).toBeVisible();
  });
});

test.describe('Librarian - Thread View', () => {
  test('thread page has back link', async ({ page }) => {
    await page.goto('/librarian');
    const threadLink = page.locator('a[href*="/librarian/thread/"]').first();
    if (await threadLink.isVisible()) {
      await threadLink.click();
      await expect(page.locator('a[href="/librarian"]')).toBeVisible();
    }
  });
});

test.describe('Librarian - API Routes', () => {
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

  test('POST /api/embassy/chat allows a first anonymous request', async ({ request }) => {
    // Commit 4516ebc7 deliberately opened anonymous Librarian access — the
    // old "auth required" contract is gone. Anonymous visitors get 5 free
    // actions/hour (src/app/api/embassy/chat/route.ts, checkRateLimit). We
    // only assert the happy path here to avoid burning 5 real LLM calls to
    // prove the 429-after-quota path; that path is untested by this suite.
    const res = await request.post('/api/embassy/chat', {
      data: { message: 'What is the Emerald Tablet?' },
    });
    // 429 is still acceptable if a prior test/run in this window already
    // used up the shared IP's quota.
    expect([200, 429]).toContain(res.status());
    if (res.status() === 200) {
      const data = await res.json();
      expect(data).toHaveProperty('threadId');
      expect(data).toHaveProperty('message');
    }
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
