/**
 * The named changes that let the app run under a plain `next start` (#8374,
 * measured in #8306), each pinned as a no-op where Vercel is concerned.
 *
 *  1. Absolute redirects: `publicUrl()` is `new URL(path, request.url)` unless
 *     SL_PUBLIC_ORIGIN is set; set, it keeps the request's own sourcelibrary.org
 *     host (tenant subdomains stay on-host) and refuses any other.
 *  2. botid is gone from the build config and the client.
 *  3. An empty journey search drops the panel during a build, and still throws
 *     at request time.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';

const BOOK_ID = '69aebe60c0472fef6455a8f3';
const SLUG = 'mathematicall-magick-wilkins';

vi.mock('@/lib/mongodb', () => ({ getReadDb: async () => ({}) }));
vi.mock('@/lib/book-lookup', () => ({
  findBookByIdOrSlug: async (_db: unknown, idOrSlug: string) =>
    idOrSlug === BOOK_ID ? { book: { id: BOOK_ID, slug: SLUG }, matchedBySlug: false } : null,
}));
const search = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock('@/lib/semantic-search', () => ({ semanticPageSearchGlobal: async () => search.rows }));
vi.mock('@/lib/book-access', () => ({ isHiddenBook: () => false }));

import { publicUrl } from '@/lib/public-origin';
import { GET as bookSlugRedirect } from '@/app/api/redirect/book-slug/route';
import { loadSearch } from '@/lib/journey/load-journey';

const ROOT = path.resolve(__dirname, '../..');

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('publicUrl', () => {
  // What `next start` hands a route handler when bound to port 3100.
  const local = (headers: Record<string, string>) =>
    new Request('https://localhost:3100/q/abc', { headers });

  it('is new URL(path, request.url) when SL_PUBLIC_ORIGIN is unset (Vercel)', () => {
    vi.stubEnv('SL_PUBLIC_ORIGIN', '');
    const req = new Request('https://bph.sourcelibrary.org/x', { headers: { host: 'evil.example' } });
    expect(publicUrl('/book/a', req).href).toBe('https://bph.sourcelibrary.org/book/a');
    expect(publicUrl('/book/a', local({})).href).toBe('https://localhost:3100/book/a');
  });

  it('uses the configured origin instead of the bind address', () => {
    vi.stubEnv('SL_PUBLIC_ORIGIN', 'https://sourcelibrary.org');
    expect(publicUrl('/book/a', local({})).href).toBe('https://sourcelibrary.org/book/a');
    expect(publicUrl('/book/a', local({ host: 'sourcelibrary.org' })).href).toBe('https://sourcelibrary.org/book/a');
  });

  it('keeps a tenant subdomain on its own host (tenant-lockdown invariant 1)', () => {
    vi.stubEnv('SL_PUBLIC_ORIGIN', 'https://sourcelibrary.org');
    expect(publicUrl('/book/a', local({ host: 'bph.sourcelibrary.org' })).href).toBe('https://bph.sourcelibrary.org/book/a');
    expect(publicUrl('/', local({ 'x-forwarded-host': 'bhutan.sourcelibrary.org', host: 'localhost:3100' })).href)
      .toBe('https://bhutan.sourcelibrary.org/');
  });

  it('never redirects to a host it does not serve', () => {
    vi.stubEnv('SL_PUBLIC_ORIGIN', 'https://sourcelibrary.org');
    for (const host of ['evil.example', 'sourcelibrary.org.evil.example', 'evilsourcelibrary.org', 'a b.sourcelibrary.org']) {
      expect(publicUrl('/book/a', local({ host })).host).toBe('sourcelibrary.org');
    }
  });

  it('carries query strings and absolute paths unchanged', () => {
    vi.stubEnv('SL_PUBLIC_ORIGIN', 'https://sourcelibrary.org');
    const url = publicUrl('/book/a/page/b?highlight=x', local({ host: 'sourcelibrary.org' }));
    expect(url.pathname).toBe('/book/a/page/b');
    expect(url.searchParams.get('highlight')).toBe('x');
  });
});

describe('a route handler redirect under next start', () => {
  const req = () =>
    new NextRequest('https://localhost:3100/api/redirect/book-slug', {
      headers: { 'x-redirect-book': BOOK_ID, host: 'sourcelibrary.org' },
    });

  it('points at the bind address without SL_PUBLIC_ORIGIN (the #8306 measurement)', async () => {
    vi.stubEnv('SL_PUBLIC_ORIGIN', '');
    const res = await bookSlugRedirect(req());
    expect(res.headers.get('location')).toBe(`https://localhost:3100/book/${SLUG}`);
  });

  it('points at the public host with it', async () => {
    vi.stubEnv('SL_PUBLIC_ORIGIN', 'https://sourcelibrary.org');
    const res = await bookSlugRedirect(req());
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(`https://sourcelibrary.org/book/${SLUG}`);
  });
});

describe('botid', () => {
  it('is not wired into the build or the client', () => {
    expect(readFileSync(path.join(ROOT, 'next.config.ts'), 'utf8')).not.toMatch(/from 'botid/);
    expect(existsSync(path.join(ROOT, 'instrumentation-client.ts'))).toBe(false);
    expect(existsSync(path.join(ROOT, 'src/instrumentation-client.ts'))).toBe(false);
  });
});

describe('journey search with no results', () => {
  const here = { bookId: BOOK_ID, pageId: 'p1' };
  const db = {} as Parameters<typeof loadSearch>[0];

  it('drops the panel during a build', async () => {
    search.rows = [];
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(loadSearch(db, 'philosophers stone', here)).resolves.toBeUndefined();
  });

  it('still throws at request time, so the last good render keeps serving', async () => {
    search.rows = [];
    vi.stubEnv('NEXT_PHASE', '');
    await expect(loadSearch(db, 'philosophers stone', here)).rejects.toThrow(/returned nothing/);
  });
});
