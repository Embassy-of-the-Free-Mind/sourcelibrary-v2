/**
 * The 404 log records broken links, not correct refusals (#102).
 *
 * A hidden book 404s by design and is skipped. The skip used to miss the same
 * book behind a locale prefix: 516 of 5,333 rows in 90 days were
 * `/es|la|zh|nl/book/<hidden>`. And a row now carries the host it happened on,
 * so a partner-host 404 can be told from a main-site one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  books: {} as Record<string, { visible?: boolean; hidden?: boolean }>,
  logged: [] as Record<string, unknown>[],
}));

vi.mock('@/lib/mongodb', () => ({
  getDb: async () => ({
    collection: (name: string) => name === 'books'
      ? {
        findOne: async (q: { $or: Record<string, string>[] }) => {
          for (const c of q.$or) {
            const hit = state.books[c.slug ?? c.id];
            if (hit) return hit;
          }
          return null;
        },
      }
      : {
        findOneAndUpdate: async (_f: unknown, u: { $setOnInsert: Record<string, unknown> }) => {
          state.logged.push(u.$setOnInsert);
          return null;
        },
      },
  }),
}));

import { POST } from '@/app/api/analytics/not-found/route';

const post = (url: string, host = 'sourcelibrary.org') =>
  POST(new NextRequest(`https://${host}/api/analytics/not-found`, {
    method: 'POST',
    headers: { host, 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
    body: JSON.stringify({ url }),
  }));

beforeEach(() => {
  state.books = { 'hidden-book': { visible: false }, 'live-book': { visible: true } };
  state.logged = [];
});

describe('POST /api/analytics/not-found', () => {
  it.each([
    '/book/hidden-book',
    '/book/hidden-book/page/abc',
    '/es/book/hidden-book',
    '/la/book/hidden-book?utm_source=chatgpt.com',
    '/zh/book/hidden-book/page/abc',
    '/nl/artwork/hidden-book',
  ])('does not record the correct 404 of a hidden book: %s', async (url) => {
    await post(url);
    expect(state.logged).toHaveLength(0);
  });

  it.each([
    '/book/no-such-book',
    '/es/book/no-such-book',
    '/es/book/live-book/page/not-a-page',
    '/es/collections/hidden-book',
    '/esperanto/book/hidden-book',
  ])('records a real broken link: %s', async (url) => {
    await post(url);
    expect(state.logged).toHaveLength(1);
    expect(state.logged[0].url).toBe(url);
  });

  it('records the host the reader was on', async () => {
    await post('/bph/collections/magic', 'bph.sourcelibrary.org');
    expect(state.logged[0].host).toBe('bph.sourcelibrary.org');
    await post('/bph/collections/magic');
    expect(state.logged[1].host).toBe('sourcelibrary.org');
  });
});
