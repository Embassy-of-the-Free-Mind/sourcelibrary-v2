/**
 * Partner lockdown for BOOKS on a tenant subdomain (#5038).
 *
 * Decision 2026-09-24: a partner host serves only the partner's own books plus
 * the global books its catalogue links (#4218). Before this, the proxy admitted
 * every untenanted book, so bhutan.sourcelibrary.org rendered e.g. Kabbala
 * Denudata's landing page while the strict page reader 404'd its pages; and the
 * landing page was the GLOBAL render, whose related-book rails linked 70 books
 * Bhutan does not hold.
 *
 * Calls proxy() directly: a Vercel preview cannot exercise a subdomain rewrite
 * (see tenant-lockdown.md), so this is the only check short of deploying.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

const BHUTAN_ID = 'bhutan-uuid';
const books: Record<string, { id: string; tenantId?: string }> = {
  'own-book': { id: 'own', tenantId: BHUTAN_ID },
  'linked-book': { id: 'linked' },
  'kabbala-denudata': { id: 'kabbala' },
  'bph-book': { id: 'bphbook', tenantId: 'bph-uuid' },
};

// Every collection answers findOne from these tables; any other method (the
// proxy's fire-and-forget request counters) is a harmless no-op.
function fakeCollection(name: string) {
  return new Proxy({}, {
    get: (_t, prop) => {
      if (prop === 'findOne') {
        return async (q: { slug?: string; $or?: Array<Record<string, string>> }) => {
          if (name === 'tenants') return q.slug === 'bhutan' ? { id: BHUTAN_ID, slug: 'bhutan' } : null;
          if (name === 'books') {
            const seg = q.$or?.[0]?.slug ?? '';
            return books[seg] ?? null;
          }
          return null;
        };
      }
      return () => ({ catch: () => undefined, then: (r: (v: unknown) => void) => r(undefined) });
    },
  });
}

vi.mock('@/lib/mongodb', () => ({
  getDb: async () => ({ collection: (n: string) => fakeCollection(n) }),
  getReadDb: async () => ({ collection: (n: string) => fakeCollection(n) }),
}));
vi.mock('@/lib/tenant-catalog-books', () => ({
  tenantCatalogReferencesBook: async (tenant: string, id: string) => tenant === 'bhutan' && id === 'linked',
}));

import { proxy } from '@/proxy';

const HOST = 'bhutan.sourcelibrary.org';
const req = (path: string) =>
  new NextRequest(`https://${HOST}${path}`, {
    headers: { host: HOST, 'user-agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36' },
  });
const rewriteTarget = (res: Response) => res.headers.get('x-middleware-rewrite');

describe('book lockdown on a partner subdomain', () => {
  it("rewrites the partner's own book to the tenant-aware embed route", async () => {
    const res = await proxy(req('/book/own-book'));
    expect(rewriteTarget(res)).toContain('/embed/bhutan/book/own-book');
  });

  it('rewrites a catalogue-linked global book to the embed route', async () => {
    const res = await proxy(req('/book/linked-book'));
    expect(rewriteTarget(res)).toContain('/embed/bhutan/book/linked-book');
  });

  it('refuses a global book the catalogue does not link — landing page', async () => {
    const res = await proxy(req('/book/kabbala-denudata'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/');
    expect(new URL(res.headers.get('location')!).host).toBe(HOST);
  });

  it('refuses the same book on a deeper path (page reader) too', async () => {
    const res = await proxy(req('/book/kabbala-denudata/page/abc123'));
    expect(res.status).toBe(307);
  });

  it("refuses another partner's book", async () => {
    const res = await proxy(req('/book/bph-book'));
    expect(res.status).toBe(307);
  });

  it('leaves an unknown slug to the route (404 or alias redirect there)', async () => {
    const res = await proxy(req('/book/no-such-book'));
    expect(res.status).not.toBe(307);
  });

  it('does not touch the apex', async () => {
    const res = await proxy(new NextRequest('https://sourcelibrary.org/book/kabbala-denudata', {
      headers: { host: 'sourcelibrary.org', 'user-agent': 'Mozilla/5.0 Chrome/120' },
    }));
    expect(res.status).not.toBe(307);
    expect(rewriteTarget(res) ?? '').not.toContain('/embed/');
  });
});
