/**
 * Reader URLs must canonicalise to the book's slug.
 *
 * /book/<id> has 301'd to /book/<slug> for a long time, but the reader one
 * level down did not: /book/6a58f512…/page/6a58f512… served a 200 and left an
 * unreadable URL in the address bar, which is what readers copy into citations
 * and chat messages. Worse, turning a page rewrote a slug URL back to the id
 * form (PageEditorClient's pushState), so a reader who entered on a good URL
 * left with a bad one.
 *
 * The redirect is wired in the proxy, not in the page, because the per-page
 * reader route is ISR — calling redirect() there would have to read
 * searchParams and force it dynamic. Same reason the /book/<id> and
 * /book/<slug>/page/<number> redirects already live here.
 *
 * These call proxy() directly. Per CLAUDE.md, a Vercel preview cannot verify
 * proxy behaviour (Host-header resolution serves the production deployment),
 * and a test that greps proxy.ts for a string would only catch deletion.
 */
import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';

import { proxy } from '@/proxy';

const BOOK_ID = '6a58f512c6cd8f9871069afb';
const PAGE_ID = '6a58f512c6cd8f9871069b13';
const SLUG = 'a-sacred-repository-of-anthems-and-hymns-for-devotional-canterbury';

const req = (path: string) =>
  new NextRequest(`https://sourcelibrary.org${path}`, {
    headers: {
      host: 'sourcelibrary.org',
      'user-agent': 'Mozilla/5.0 Chrome/124',
      'accept-language': 'en',
      'sec-fetch-mode': 'navigate',
    },
  });

/** The internal rewrite target, or null when the proxy left the request alone. */
const rewriteTarget = (res: Response | null | undefined) => {
  const target = res?.headers.get('x-middleware-rewrite');
  return target ? new URL(target).pathname : null;
};

/** A request header the proxy set on the rewritten request. */
const forwarded = (res: Response | null | undefined, name: string) =>
  res?.headers.get(`x-middleware-request-${name}`);

describe('reader URL canonicalisation', () => {
  it('sends an id-addressed reader URL to the slug resolver', async () => {
    const res = await proxy(req(`/book/${BOOK_ID}/page/${PAGE_ID}`));

    expect(rewriteTarget(res)).toBe('/api/redirect/book-slug');
    expect(forwarded(res, 'x-redirect-book')).toBe(BOOK_ID);
    expect(forwarded(res, 'x-redirect-page-id')).toBe(PAGE_ID);
  });

  it('carries the query string through, so ?highlight= and ?v= survive', async () => {
    // ?v= pins a cited edition version and ?highlight= pins a search term.
    // Dropping either changes what the reader lands on without saying so.
    const res = await proxy(req(`/book/${BOOK_ID}/page/${PAGE_ID}?highlight=mercury&v=2`));

    expect(rewriteTarget(res)).toBe('/api/redirect/book-slug');
    expect(forwarded(res, 'x-redirect-search')).toBe('?highlight=mercury&v=2');
  });

  it('leaves a slug-addressed reader URL alone', async () => {
    // The common case, and the one that must never pay for a Mongo lookup.
    const res = await proxy(req(`/book/${SLUG}/page/${PAGE_ID}`));

    expect(rewriteTarget(res)).not.toBe('/api/redirect/book-slug');
  });

  it('still resolves a page *number* in one hop, not two', async () => {
    // /book/<id>/page/5 must go to the page-number resolver (number → page id
    // AND id → slug in a single 301), not bounce through the slug resolver.
    const res = await proxy(req(`/book/${BOOK_ID}/page/5`));

    expect(rewriteTarget(res)).toBe('/api/redirect/book-page');
    expect(forwarded(res, 'x-redirect-page')).toBe('5');
  });

  it('does not re-rewrite once the resolver has bounced back (ns=1)', async () => {
    // Books with no slug bounce back with ns=1. Without this guard the proxy
    // would rewrite it straight back to the resolver, forever.
    const res = await proxy(req(`/book/${BOOK_ID}/page/${PAGE_ID}?ns=1`));

    expect(rewriteTarget(res)).not.toBe('/api/redirect/book-slug');
  });
});
