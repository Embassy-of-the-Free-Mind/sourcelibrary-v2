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

  // The suggestion chips are NOT stable content. LibrarianClient redraws the
  // set twice after first paint (`pickSuggestions`): once on mount, and again
  // when the public-threads fetch resolves and blends in real visitor
  // questions. So neither the wording of a chip nor its presence in the set
  // survives long enough to assert on — both produced the #3358 flake:
  //
  //   1. locating chips by keyword (/Agrippa|Kabbalah|.../) — the redraw picks
  //      4 of ~30 suggestions at random, so a keyword can vanish entirely and
  //      the click times out;
  //   2. capturing a chip's text and asserting the textarea matches THAT text
  //      — the redraw can swap the chip between the read and the click.
  //
  // Both are fixed by locating chips structurally and asserting the behaviour.
  const chips = (page: import('@playwright/test').Page) =>
    page.getByTestId('suggestion-chip');

  test('shows suggestion chips', async ({ page }) => {
    await expect(chips(page).first()).toBeVisible();
    expect(await chips(page).count()).toBeGreaterThanOrEqual(1);
  });

  test('clicking suggestion populates input', async ({ page }) => {
    await expect(chips(page).first()).toBeVisible();

    const textarea = page.locator('textarea');
    await expect(textarea).toHaveValue('');
    await chips(page).first().click();

    // Empty → a whole question (4+ words). WHICH question is deliberately not
    // asserted; see the note above.
    await expect(textarea).toHaveValue(/\S+(\s+\S+){3,}/);
  });

  test('anonymous visitors can use the Librarian input', async ({ page }) => {
    // Anonymous access was deliberately opened up (5 free actions/hour via
    // src/lib/anon-gate.ts) — the textarea is enabled for everyone, with a
    // soft "sign in to save your conversations" note below the input rather
    // than a hard disabled-input gate.
    await expect(page.locator('textarea')).toBeEnabled();
    await expect(page.locator('textarea')).toHaveAttribute('placeholder', 'Ask the Librarian...');
    // Assert the nudge STRUCTURALLY — the sign-in link plus the fact that it
    // sits below the composer — not on its wording. #4007 reworded this line
    // ("to save your conversations and keep them private" → "to keep your
    // conversations and come back to them later") and broke the test the next
    // morning; the behaviour under test (a soft prompt, not a hard gate) never
    // changed. What matters is that anonymous visitors get a link, not a wall.
    // Match the composer nudge by its exact href, not by role+name: the header
    // UserMenu also renders a "Sign in" link (bare /auth/signin), so a name
    // locator would pass even if the nudge below the input disappeared.
    await expect(
      page.locator('a[href="/auth/signin?callbackUrl=/librarian"]')
    ).toBeVisible();
  });

  test('shows Recent tab', async ({ page }) => {
    // `exact: true` is load-bearing. #4007 made conversations listed by
    // default, which renders a "Listed (shown in Recent, never under your
    // name)" toggle above the composer — a second button containing the word
    // "Recent", so the old substring locator became a strict-mode violation.
    await expect(page.getByRole('button', { name: 'Recent', exact: true })).toBeVisible();
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
