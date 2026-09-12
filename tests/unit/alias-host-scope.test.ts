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

describe('proxy() on preview deployments', () => {
  // Preview URLs are public — the Vercel bot posts them on every PR of this
  // public repo — and previews sit outside Cloudflare. The bug being pinned:
  // an outside party read books through a stale worktree preview (2026-08-09).
  const PREVIEW = 'https://sourcelibrary-v2-git-worktree-reader-1df8dc-dereklomas-projects.vercel.app';

  it('refuses anonymous book content with a loud 403, not a redirect', async () => {
    for (const p of ['/book/some-slug?page=3', '/api/books/abc123/text', '/embed/bph/reader/x']) {
      const res = await proxy(req(`${PREVIEW}${p}`));
      expect(res?.status, p).toBe(403);
      // A 308 here would make an e2e run pointed at a preview silently crawl
      // production — the refusal must terminate, never forward.
      expect(res?.headers.get('location'), p).toBeNull();
    }
  });

  it('gates the LOCALIZED twin of a content path, not just the English one', async () => {
    // `/es/book/x` is the same book as `/book/x`. The gate matched the raw
    // pathname, so from the day the Spanish twin shipped every preview served
    // the whole record to anonymous callers while the English URL 403'd.
    // Matching on the locale-stripped path also covers a future `/fr`.
    for (const p of ['/es/book/some-slug', '/es/book/some-slug/page/abc', '/es/book/some-slug/page-number/9']) {
      const res = await proxy(req(`${PREVIEW}${p}`));
      expect(res?.status, p).toBe(403);
      expect(res?.headers.get('location'), p).toBeNull();
    }
  });

  it('does not gate a localized NON-content path', async () => {
    // The stripping must not turn every /es page into book content.
    for (const p of ['/es', '/es/collections', '/es/support']) {
      const res = await proxy(req(`${PREVIEW}${p}`));
      expect(res?.status, p).not.toBe(403);
    }
  });

  it('lets a signed-in dev review the branch', async () => {
    const res = await proxy(
      req(`${PREVIEW}/book/some-slug`, { cookie: '__Secure-authjs.session-token=tok' })
    );
    expect(res?.status).not.toBe(403);
  });

  it('lets credentialed callers through to app-layer auth', async () => {
    const res = await proxy(
      req(`${PREVIEW}/api/books/abc123/text`, { authorization: 'Bearer whatever' })
    );
    expect(res?.status).not.toBe(403);
  });

  it('leaves non-content surfaces open for anonymous review', async () => {
    for (const p of ['/', '/collections/hermetica', '/api/auth/session', '/_next/static/x.js']) {
      const res = await proxy(req(`${PREVIEW}${p}`));
      expect(res?.status, p).not.toBe(403);
      expect(res?.status, p).not.toBe(308);
    }
  });

  it('a forged embed Origin does not bypass the gate on /api/books', async () => {
    // The embed-CORS branch passes /api/books through on an allowlisted
    // Origin header — which the caller controls. The preview gate must run
    // before it, so an allowlisted Origin buys a bot nothing here.
    const prev = process.env.EMBED_ALLOWED_ORIGINS;
    process.env.EMBED_ALLOWED_ORIGINS = 'partner.example.org';
    try {
      const res = await proxy(
        req(`${PREVIEW}/api/books/abc123/text`, { origin: 'https://partner.example.org' })
      );
      expect(res?.status).toBe(403);
      // Same request on the canonical host still gets its CORS pass-through.
      const canonical = await proxy(
        req('https://sourcelibrary.org/api/books/abc123/text', {
          origin: 'https://partner.example.org',
        })
      );
      expect(canonical?.headers.get('access-control-allow-origin')).toBe(
        'https://partner.example.org'
      );
    } finally {
      if (prev === undefined) delete process.env.EMBED_ALLOWED_ORIGINS;
      else process.env.EMBED_ALLOWED_ORIGINS = prev;
    }
  });

  it('does not touch the canonical host or the bare production alias policy', async () => {
    const res = await proxy(req('https://sourcelibrary.org/book/some-slug'));
    expect(res?.status).not.toBe(403);
    // The bare alias keeps its own 308 policy from #3446.
    const alias = await proxy(req('https://sourcelibrary-v2.vercel.app/book/some-slug'));
    expect(alias?.status).toBe(308);
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

  it('covers the four cloud operators measured on 2026-08-06', () => {
    expect(isBlockedNetwork('116.204.33.7')).toBe(true); // Huawei Cloud AS55990
    expect(isBlockedNetwork('1.92.219.4')).toBe(true); // Huawei Cloud AS55990
    expect(isBlockedNetwork('149.232.130.9')).toBe(true); // Huawei Clouds HK AS136907
    expect(isBlockedNetwork('150.5.132.1')).toBe(true); // Byteplus AS150436
    expect(isBlockedNetwork('163.7.14.200')).toBe(true); // Byteplus AS150436
    expect(isBlockedNetwork('82.157.9.1')).toBe(true); // Tencent AS45090
    expect(isBlockedNetwork('81.70.200.5')).toBe(true); // Tencent AS45090
    expect(isBlockedNetwork('49.233.140.2')).toBe(true); // Tencent AS45090
  });

  it('blocks the enumerating consumer /24s but not their neighbours', () => {
    // These are bare /24s inside consumer allocations on purpose: the block is
    // as narrow as the measurement. One /24 over in either direction is a
    // stranger who did nothing, and must still be able to read.
    expect(isBlockedNetwork('180.153.197.44')).toBe(true);
    expect(isBlockedNetwork('180.153.196.44')).toBe(false);
    expect(isBlockedNetwork('180.153.198.44')).toBe(false);
    expect(isBlockedNetwork('112.65.211.8')).toBe(true);
    expect(isBlockedNetwork('112.65.210.8')).toBe(false);
    expect(isBlockedNetwork('112.65.213.8')).toBe(false);
  });

  it('leaves genuine reader networks alone', () => {
    // Every one of these read the library in the same window and is a person:
    // Comcast, Charter, Virgin Media, University of Florida, TurkNet.
    expect(isBlockedNetwork('73.106.56.4')).toBe(false);
    expect(isBlockedNetwork('72.226.47.9')).toBe(false);
    expect(isBlockedNetwork('82.28.4.1')).toBe(false);
    expect(isBlockedNetwork('128.227.209.3')).toBe(false);
    expect(isBlockedNetwork('31.223.11.9')).toBe(false);
  });

  it('never blocks our own CDN, at any address in its ranges', () => {
    // An alarm whose remediation is self-harm; a block that lands on the CDN
    // takes the site down for everyone. Cheap to assert, catastrophic to miss.
    for (const ip of ['172.64.0.1', '172.71.148.9', '104.16.0.1', '162.158.110.3', '141.101.13.7', '173.245.48.1']) {
      expect(isBlockedNetwork(ip)).toBe(false);
    }
  });

  it('handles malformed and non-IPv4 input without matching', () => {
    expect(isBlockedNetwork('not-an-ip')).toBe(false);
    expect(isBlockedNetwork('116.204.33')).toBe(false);
    expect(isBlockedNetwork('116.204.33.7.9')).toBe(false);
    expect(isBlockedNetwork('116.204.999.7')).toBe(false);
    expect(isBlockedNetwork('unknown')).toBe(false);
    // IPv6 is deliberately never blocked — no measurement behind it.
    expect(isBlockedNetwork('2a02:c7f:1234::1')).toBe(false);
    // ...but the IPv4-mapped form must still resolve to the v4 rule.
    expect(isBlockedNetwork('::ffff:116.204.33.7')).toBe(true);
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

/**
 * The bare Vercel production alias is the last unguarded door of the same kind.
 * `sourcelibrary-v2.vercel.app` resolves straight to Vercel — no cf-ray, so no
 * edge layer — and answered the whole library; the traffic detector has flagged
 * reader traffic on it every run since #3446.
 *
 * It could not simply 308 everything: scripts/uptime-monitor.mjs probes it and
 * the Playwright suite defaults BASE_URL to it, so a catch-all would have
 * silently repointed a page-crawler at production. These pin both halves — the
 * library leaves, the operational probes stay.
 */
describe('bare Vercel production alias', () => {
  const DEPLOY_HOST = 'https://sourcelibrary-v2.vercel.app';

  it.each([
    '/book/chymische-hochzeit-christiani-rosencreutz-andreae',
    '/book/some-slug/page/abc123',
    '/collections/hermetica',
    '/gallery',
    '/gallery/image/xyz',
    '/author/paracelsus',
    '/artwork/bembine-table-of-isis',
    '/encyclopedia/Matthiolus',
    '/api/books/abc/text',
    '/api/books/abc/quote',
    '/api/image',
    '/embed/bph/book/some-slug',
  ])('308s the reader surface: %s', async (path) => {
    const res = await proxy(req(`${DEPLOY_HOST}${path}`));
    expect(res?.status).toBe(308);
    expect(res?.headers.get('location')).toBe(`https://sourcelibrary.org${path}`);
  });

  it.each([
    '/api/health',
    '/api/books',
    '/embed/bph',
    '/embed/ficino',
    '/embed/bhutan',
    '/_next/static/chunks/main.js',
  ])('leaves the operational probes in place: %s', async (path) => {
    const res = await proxy(req(`${DEPLOY_HOST}${path}`));
    expect(res?.status).not.toBe(308);
  });

  it('preserves the query string when redirecting', async () => {
    const res = await proxy(req(`${DEPLOY_HOST}/search?q=alchemy&page=2`));
    expect(res?.headers.get('location')).toBe('https://sourcelibrary.org/search?q=alchemy&page=2');
  });

  it('does NOT scope preview deployments', async () => {
    // Branch review depends on these serving the whole site. A
    // host.includes('vercel.app') test here would take every preview out —
    // which is why the deployment alias is matched exactly.
    for (const host of [
      'https://sourcelibrary-v2-git-fix-something.vercel.app',
      'https://sourcelibrary-v2-32g32u0ho-dereklomas-projects.vercel.app',
    ]) {
      const res = await proxy(req(`${host}/book/some-slug`));
      expect(res?.status, host).not.toBe(308);
    }
  });

  it('does not touch the canonical host', async () => {
    const res = await proxy(req('https://sourcelibrary.org/book/some-slug'));
    expect(res?.status).not.toBe(308);
  });
});
