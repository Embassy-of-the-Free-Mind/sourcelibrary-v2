/**
 * Alias hosts serve only their own surface; refused networks are refused on
 * every host. Both exercised through `proxy()` itself — the point is the
 * response a client receives, not the shape of the source.
 *
 * The bug being pinned: `ficinosociety.org` served the entire library because
 * SOCIETY_DOMAINS was an additive allowlist, and that host sits outside the
 * Cloudflare zone, so it was where the AS132203 fleet actually read.
 */
import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
import { shouldRedirectToCanonical } from '@/lib/alias-host-scope';
import { isBlockedNetwork } from '@/lib/blocked-networks';

// `host` must be set explicitly: undici treats it as a forbidden header, so a
// Request built from a URL alone exposes no host to the proxy — and the proxy
// routes on that header.
const req = (url: string, headers: Record<string, string> = {}) =>
  new NextRequest(new Request(url, { headers: { host: new URL(url).host, ...headers } }));

describe('shouldRedirectToCanonical', () => {
  it('redirects library surfaces off an alias host', () => {
    for (const p of [
      '/book/chymische-hochzeit-christiani-rosencreutz-andreae',
      '/artwork/bembine-table-of-isis',
      '/collections/hermetica',
      '/gallery',
      '/api/image',
      '/api/books/abc/text',
      '/search',
    ]) {
      expect(shouldRedirectToCanonical(p), p).toBe(true);
    }
  });

  it('keeps the society surface and what it needs to run', () => {
    for (const p of [
      '/',
      '/ficino-society',
      '/discussions',
      '/discussions/42',
      '/members',
      '/_next/static/chunk.js',
      '/api/auth/session',
      '/api/ficino/discussions',
      '/api/presence',
      // Telemetry stays local so this host's traffic remains measurable —
      // losing that visibility is how the bypass went unnoticed.
      '/api/analytics/track',
      '/api/track',
      '/favicon.ico',
    ]) {
      expect(shouldRedirectToCanonical(p), p).toBe(false);
    }
  });

  it('does not let a prefix match a longer unrelated segment', () => {
    // '/members' is allowed; '/membership-plans' is not the same surface.
    expect(shouldRedirectToCanonical('/membership-plans')).toBe(true);
    expect(shouldRedirectToCanonical('/discussions-archive')).toBe(true);
  });
});

describe('proxy() on the ficinosociety alias', () => {
  it('308s a book page to the canonical domain, preserving path and query', async () => {
    const res = await proxy(req('https://ficinosociety.org/book/some-slug?utm=x'));
    expect(res?.status).toBe(308);
    expect(res?.headers.get('location')).toBe('https://sourcelibrary.org/book/some-slug?utm=x');
  });

  it('scopes the host BEFORE library-specific routing gets a turn', async () => {
    // /book/<slug>?page=N is rewritten to the bare-page resolver early in the
    // proxy. While the alias check sat after that, this shape stayed on the
    // alias host for a hop; scoping now happens first, so it leaves immediately.
    const res = await proxy(req('https://ficinosociety.org/book/some-slug?page=3'));
    expect(res?.status).toBe(308);
    expect(res?.headers.get('location')).toBe('https://sourcelibrary.org/book/some-slug?page=3');
  });

  it('still serves the society surface in place', async () => {
    const res = await proxy(req('https://ficinosociety.org/discussions'));
    expect(res?.status).not.toBe(308);
  });

  it('leaves the canonical host alone', async () => {
    const res = await proxy(req('https://sourcelibrary.org/book/some-slug'));
    expect(res?.status).not.toBe(308);
  });
});

describe('isBlockedNetwork', () => {
  it('covers 43.172.0.0/15, both halves', () => {
    expect(isBlockedNetwork('43.172.195.14')).toBe(true);
    expect(isBlockedNetwork('43.173.181.2')).toBe(true);
  });

  it('does not bleed into neighbouring space', () => {
    // 43.171.x and 43.174.x are outside the measured range.
    expect(isBlockedNetwork('43.171.195.14')).toBe(false);
    expect(isBlockedNetwork('43.174.195.14')).toBe(false);
    expect(isBlockedNetwork('143.172.195.14')).toBe(false);
    expect(isBlockedNetwork(null)).toBe(false);
    expect(isBlockedNetwork('')).toBe(false);
  });
});

describe('proxy() refuses blocked networks on every host', () => {
  it.each([
    'https://sourcelibrary.org/book/some-slug',
    'https://ficinosociety.org/book/some-slug',
    'https://sourcelibrary-v2.vercel.app/book/some-slug',
    'https://bph.sourcelibrary.org/book/some-slug',
  ])('403s %s', async (url) => {
    const res = await proxy(req(url, { 'x-forwarded-for': '43.173.181.5' }));
    expect(res?.status).toBe(403);
    expect(await res!.text()).toContain('licensing');
  });

  it('does not touch an ordinary visitor', async () => {
    const res = await proxy(req('https://sourcelibrary.org/', { 'x-forwarded-for': '81.204.11.9' }));
    expect(res?.status).not.toBe(403);
  });
});
