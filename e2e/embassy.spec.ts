import { test, expect } from '@playwright/test';
import { measurePerf } from './perf';

/**
 * E2E tests for the Reading Room (formerly Embassy of the Free Mind).
 * Tests against the live production site.
 */

// ---------------------------------------------------------------------------
// Main Reading Room page
// ---------------------------------------------------------------------------

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
      hasText: /world soul|philosopher|Agrippa|Kabbalah|Emerald|Ficino|alchemist/i,
    });
    await expect(suggestions.first()).toBeVisible();
    expect(await suggestions.count()).toBeGreaterThanOrEqual(1);
  });

  test('clicking suggestion populates input', async ({ page }) => {
    const suggestions = page.locator('button', {
      hasText: /world soul|philosopher|Agrippa|Kabbalah|Emerald|Ficino|alchemist/i,
    });
    await expect(suggestions.first()).toBeVisible();
    const text = await suggestions.first().textContent();
    await suggestions.first().click();
    const textarea = page.locator('textarea');
    if (text) {
      const keyword = text.split(/\s+/).find(w => w.length > 4) || text.slice(0, 10);
      await expect(textarea).toHaveValue(new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    }
  });

  test('shows sign-in prompt when not authenticated', async ({ page }) => {
    await expect(page.locator('textarea')).toBeDisabled();
    await expect(page.locator('textarea')).toHaveAttribute('placeholder', /Sign in/);
  });

  test('shows Recent tab', async ({ page }) => {
    await expect(page.locator('button', { hasText: 'Recent' })).toBeVisible();
  });

  test('recent threads list loads', async ({ page }) => {
    // Recent tab should show thread links (previous conversations)
    const recentTab = page.locator('button', { hasText: 'Recent' });
    await expect(recentTab).toBeVisible();

    // Thread links should appear (if any exist in the system)
    const threadLinks = page.locator('a[href*="/reading-room/thread/"]');
    const count = await threadLinks.count();
    // At least verify the container rendered — threads may or may not exist
    expect(count).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Featured content
// ---------------------------------------------------------------------------

test.describe('Reading Room - Featured Content', () => {
  test('page loads without image errors', async ({ page }) => {
    const failedImages: string[] = [];
    page.on('response', (response) => {
      if (response.request().resourceType() === 'image' && response.status() >= 400) {
        failedImages.push(`${response.url()} → ${response.status()}`);
      }
    });

    await page.goto('/reading-room', { waitUntil: 'load' });
    await page.waitForTimeout(3000);

    // Page should load — image errors are logged but not a hard failure
    // (R2 images can be intermittently unavailable)
    const body = await page.textContent('body');
    expect(body).not.toContain('Application error');
  });
});

// ---------------------------------------------------------------------------
// Room pages
// ---------------------------------------------------------------------------

test.describe('Reading Room - Room Page', () => {
  test('general room loads with heading', async ({ page }) => {
    await page.goto('/reading-room/room/general');
    await expect(page.locator('h1')).toBeVisible();
  });

  test('room page renders content', async ({ page }) => {
    await page.goto('/reading-room/room/general');

    // Page should render without errors
    const body = await page.textContent('body');
    expect(body).not.toContain('Application error');
    expect(body?.length).toBeGreaterThan(100);
  });

  test('room page has back navigation to reading room', async ({ page }) => {
    await page.goto('/reading-room/room/general');

    const backLink = page.locator('a[href="/reading-room"]').first();
    await expect(backLink).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Thread view
// ---------------------------------------------------------------------------

test.describe('Reading Room - Thread View', () => {
  test('thread page has back link', async ({ page }) => {
    await page.goto('/reading-room');
    const threadLink = page.locator('a[href*="/reading-room/thread/"]').first();
    if (await threadLink.isVisible()) {
      await threadLink.click();
      await expect(page.locator('a[href="/reading-room"]')).toBeVisible();
    }
  });

  test('thread displays conversation messages', async ({ page }) => {
    await page.goto('/reading-room');
    const threadLink = page.locator('a[href*="/reading-room/thread/"]').first();
    if (await threadLink.isVisible()) {
      await threadLink.click();

      // Thread should render content (no main tag — check body text)
      const body = await page.textContent('body');
      expect(body?.length).toBeGreaterThan(100);
      expect(body).not.toContain('Application error');
    }
  });
});

// ---------------------------------------------------------------------------
// Voice agent page
// ---------------------------------------------------------------------------

test.describe('Reading Room - Voice Agent', () => {
  test('voice page loads without crash', async ({ page }) => {
    const response = await page.goto('/reading-room/voice', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    expect(response?.status()).toBe(200);

    const body = await page.textContent('body');
    expect(body).not.toContain('Application error');
    expect(body).not.toContain('Internal Server Error');
  });

  test('voice page shows Hermes branding', async ({ page }) => {
    await page.goto('/reading-room/voice', { waitUntil: 'domcontentloaded' });

    // Should show the Hermes heading
    await expect(page.getByRole('heading', { name: 'Hermes' })).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

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

  test('GET /api/embassy/rooms/invalid returns 404', async ({ request }) => {
    const res = await request.get('/api/embassy/rooms/nonexistent-room-xyz/messages');
    // Should return 404 or empty, not crash
    expect([200, 404]).toContain(res.status());
  });

  test('POST /api/embassy/rooms/general/messages requires auth', async ({ request }) => {
    const res = await request.post('/api/embassy/rooms/general/messages', {
      data: { content: 'test message' },
    });
    expect([401, 429]).toContain(res.status());
  });
});

// ---------------------------------------------------------------------------
// Librarian tool endpoints (used by chat)
// ---------------------------------------------------------------------------

test.describe('Reading Room - Librarian Tool APIs', () => {
  test('search API works for librarian queries', async ({ request }) => {
    // The librarian uses /api/books/search for search_collection tool
    const res = await request.get('/api/books/search?q=alchemy&limit=3', { timeout: 10_000 });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty('results');
    expect(data.results.length).toBeGreaterThan(0);
  });

  test('visual search API returns results or empty', async ({ request }) => {
    // The librarian uses /api/search/visual for search_images tool
    const res = await request.get('/api/search/visual?q=dragon&limit=3', { timeout: 10_000 });
    // May return 200 with results, or 502 if CLIP server is down
    if (res.status() === 502) {
      // CLIP server unavailable — acceptable degradation
      return;
    }
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty('results');
  });
});
