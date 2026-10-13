/**
 * The id → slug 301 must carry Next's `_rsc` cache-busting param through for
 * an RSC request (#6438).
 *
 * A <Link href="/book/<id>"> prefetches the id form as an RSC request with
 * `?_rsc=<hash>`. When the 301's Location drops that param, the browser follows
 * it to the bare slug URL still carrying the RSC header, the CDN answers with
 * the cached HTML document (it does not key on that header), and the Next
 * client throws the response away and fetches the slug again with the param:
 * three requests per link instead of two, one of them answered with the wrong
 * content type. Measured in a browser against /blog/drebbel, 2026-10-11.
 *
 * These call the route handler directly, with the book lookup stubbed.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

const BOOK_ID = '69aebe60c0472fef6455a8f3';
const PAGE_ID = '69aebe60c0472fef6455a8f5';
const SLUG = 'mathematicall-magick-wilkins';

vi.mock('@/lib/mongodb', () => ({ getReadDb: async () => ({}) }));
vi.mock('@/lib/book-lookup', () => ({
  findBookByIdOrSlug: async (_db: unknown, idOrSlug: string) =>
    idOrSlug === BOOK_ID
      ? { book: { id: BOOK_ID, slug: SLUG }, matchedBySlug: false }
      : null,
}));

import { GET } from '@/app/api/redirect/book-slug/route';

// The URL the handler sees is the proxy's rewrite target; Next forwards the
// original request's `_rsc` onto it.
const req = (search: string, headers: Record<string, string>) =>
  new NextRequest(`https://sourcelibrary.org/api/redirect/book-slug${search}`, { headers });

const location = (res: Response) => new URL(res.headers.get('location')!);

describe('id → slug redirect and the RSC cache-busting param', () => {
  it('carries _rsc through for an RSC request', async () => {
    const res = await GET(req('?_rsc=abc12', { 'x-redirect-book': BOOK_ID, rsc: '1' }));

    expect(res.status).toBe(301);
    expect(location(res).pathname).toBe(`/book/${SLUG}`);
    expect(location(res).searchParams.get('_rsc')).toBe('abc12');
  });

  it('leaves a plain navigation alone', async () => {
    const res = await GET(req('', { 'x-redirect-book': BOOK_ID }));

    expect(res.status).toBe(301);
    expect(location(res).pathname).toBe(`/book/${SLUG}`);
    expect(location(res).search).toBe('');
  });

  it('does not copy _rsc onto a non-RSC request', async () => {
    // That 301 is CDN-cacheable; a stray param must not end up in it.
    const res = await GET(req('?_rsc=abc12', { 'x-redirect-book': BOOK_ID }));

    expect(location(res).search).toBe('');
  });

  it('keeps the reader tail and query string, and adds _rsc once', async () => {
    const res = await GET(
      req('?_rsc=abc12', {
        'x-redirect-book': BOOK_ID,
        'x-redirect-page-id': PAGE_ID,
        'x-redirect-search': '?highlight=mercury&v=2',
        rsc: '1',
      }),
    );

    expect(location(res).pathname).toBe(`/book/${SLUG}/page/${PAGE_ID}`);
    expect(location(res).searchParams.get('highlight')).toBe('mercury');
    expect(location(res).searchParams.get('v')).toBe('2');
    expect(location(res).searchParams.getAll('_rsc')).toEqual(['abc12']);
  });

  it('does not add _rsc to the render-in-place bounce', async () => {
    // Unknown id: the handler 302s back with ns=1 and the page renders its 404.
    const res = await GET(req('?_rsc=abc12', { 'x-redirect-book': 'deadbeef', rsc: '1' }));

    expect(res.status).toBe(302);
    expect(location(res).searchParams.get('ns')).toBe('1');
    expect(location(res).searchParams.has('_rsc')).toBe(false);
  });
});
