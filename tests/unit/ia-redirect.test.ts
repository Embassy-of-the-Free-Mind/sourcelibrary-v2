import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * /ia/<identifier> sends someone from an Internet Archive item to our copy
 * (#8161). What it must never do: reveal a hidden book, or pass an arbitrary
 * string into the query or the redirect.
 */
const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  filter: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/mongodb', () => ({
  getDb: async () => ({
    collection: () => ({
      find: (filter: Record<string, unknown>) => {
        state.filter = filter;
        return { sort: () => ({ limit: () => ({ toArray: async () => state.rows }) }) };
      },
    }),
  }),
}));

import { GET } from '@/app/ia/[identifier]/route';
import { isGlobalOnlyTenantPath } from '@/lib/tenant-global-paths';

const call = (identifier: string) =>
  GET(new NextRequest(`https://sourcelibrary.org/ia/${identifier}`), { params: Promise.resolve({ identifier }) });

beforeEach(() => {
  state.rows = [];
  state.filter = null;
});

describe('/ia/<identifier>', () => {
  it('redirects a held item to its book', async () => {
    state.rows = [{ id: 'abc', slug: 'de-secretis' }];
    const res = await call('desecretis00such');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://sourcelibrary.org/book/de-secretis');
  });

  it('falls back to the book id when there is no slug', async () => {
    state.rows = [{ id: 'abc' }];
    expect((await call('x1')).headers.get('location')).toBe('https://sourcelibrary.org/book/abc');
  });

  it('asks only for live books, so a hidden one reads as not held', async () => {
    await call('desecretis00such');
    expect(state.filter).toMatchObject({ visible: true, pages_count: { $gt: 0 } });
  });

  it('answers 404 with a way back to the Archive when not held', async () => {
    const res = await call('notheld00');
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('https://archive.org/details/notheld00');
  });

  it('does not query for, or echo, something that cannot be an identifier', async () => {
    const res = await call('a b<script>');
    expect(res.status).toBe(404);
    expect(state.filter).toBeNull();
    expect(await res.text()).not.toContain('script');
  });

  it('does not answer on a partner subdomain', () => {
    expect(isGlobalOnlyTenantPath('/ia/desecretis00such')).toBe(true);
  });
});
