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
const OWN_OBJECT_ID = '0123456789abcdef01234567';
const books: Record<string, { id: string; slug?: string; tenantId?: string }> = {
  'own-book': { id: 'own', slug: 'own-book', tenantId: BHUTAN_ID },
  [OWN_OBJECT_ID]: { id: OWN_OBJECT_ID, slug: 'own-book', tenantId: BHUTAN_ID },
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
            const seg = q.$or?.[0]?.slug ?? q.$or?.[0]?.id ?? '';
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

// The locale door (found 2026-09-25): `/es/*` routes are global and answered
// on every host, so bph.sourcelibrary.org/es rendered the GLOBAL Spanish
// homepage (23 foreign book links) and /es/book/<slug> the global landing
// page — the #5038 leak again, one prefix over. Partner rooms have no
// localized layout (i18n.md), so the prefix is stripped on-host.
describe('locale prefix on a partner subdomain', () => {
  const location = (res: Response) => new URL(res.headers.get('location')!);

  it('strips /es from the homepage, staying on the subdomain', async () => {
    const res = await proxy(req('/es'));
    expect(res.status).toBe(308);
    expect(location(res).pathname).toBe('/');
    expect(location(res).host).toBe(HOST);
  });

  it('strips /es from a book URL so the lockdown sees /book/<slug>', async () => {
    const res = await proxy(req('/es/book/kabbala-denudata'));
    expect(res.status).toBe(308);
    expect(location(res).pathname).toBe('/book/kabbala-denudata');
    expect(location(res).host).toBe(HOST);
  });

  it('strips /es ahead of the corpus-wide refusal (one hop, then 404 there)', async () => {
    const res = await proxy(req('/es/encyclopedia'));
    expect(res.status).toBe(308);
    expect(location(res).pathname).toBe('/encyclopedia');
  });

  it('keeps the query string', async () => {
    const res = await proxy(req('/es/search?q=fludd'));
    expect(res.status).toBe(308);
    expect(location(res).pathname).toBe('/search');
    expect(location(res).searchParams.get('q')).toBe('fludd');
  });

  it('does not strip a segment that merely starts with the locale (/escher)', async () => {
    const res = await proxy(req('/escher'));
    expect(res.status).not.toBe(308);
  });

  it('leaves the apex localized routes alone', async () => {
    const res = await proxy(new NextRequest('https://sourcelibrary.org/es/book/kabbala-denudata', {
      headers: { host: 'sourcelibrary.org', 'user-agent': 'Mozilla/5.0 Chrome/120' },
    }));
    expect(res.status).not.toBe(308);
  });
});

// The apex /book/[id] page 301s an id-form URL to its slug; the embed route a
// subdomain rewrites to did not, so a partner host served one book at two URLs.
describe('id-form book URL on a partner subdomain', () => {
  it('308s /book/<ObjectId> to /book/<slug> on-host before admission', async () => {
    const res = await proxy(req(`/book/${OWN_OBJECT_ID}`));
    expect(res.status).toBe(308);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.pathname).toBe('/book/own-book');
    expect(loc.host).toBe(HOST);
  });

  it('leaves an unknown id to the route', async () => {
    const res = await proxy(req('/book/ffffffffffffffffffffffff'));
    expect(res.status).not.toBe(308);
  });

  it('still rewrites the slug form to the embed route', async () => {
    const res = await proxy(req('/book/own-book'));
    expect(rewriteTarget(res)).toContain('/embed/bhutan/book/own-book');
  });
});
