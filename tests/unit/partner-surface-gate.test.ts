import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Who the Embassy's reading surfaces refuse (#8098). The people they must not
 * refuse are the point: a real browser in a cross-site iframe, a mobile browser
 * with no hints, a real crawler, a link preview.
 */

vi.mock('@/lib/tenant-context', () => ({ resolveTenantId: async () => 'bph-id' }));
vi.mock('@/lib/preview-credential', () => ({ hasVerifiedCredential: vi.fn(async () => false) }));
const verdict = vi.fn(async () => 'verified');
vi.mock('@/lib/crawler-verify', () => ({
  provableClaimIn: (ua: string) => (/googlebot/i.test(ua) ? 'googlebot' : /bingbot/i.test(ua) ? 'bingbot' : null),
  verifyCrawlerClaim: () => verdict(),
}));

import { isDeclaredScript, isProtectedSurface, surfaceRefusal } from '@/lib/partner-access';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';
const refusal = (h: Record<string, string>) => surfaceRefusal(new Headers(h), '198.51.100.1');

afterEach(() => { vi.unstubAllEnvs(); verdict.mockReset(); verdict.mockResolvedValue('verified'); });

describe('isProtectedSurface', () => {
  it('covers the subdomain, the embed and the tenant API, on no other path', () => {
    expect(isProtectedSurface('bph.sourcelibrary.org', '/')).toBe(true);
    expect(isProtectedSurface('bph.sourcelibrary.org', '/api/image')).toBe(true);
    expect(isProtectedSurface('sourcelibrary.org', '/embed/bph')).toBe(true);
    expect(isProtectedSurface('sourcelibrary.org', '/embed/bph/book/x')).toBe(true);
    expect(isProtectedSurface('sourcelibrary.org', '/api/bph/pages/batch')).toBe(true);
    for (const p of ['/', '/book/x', '/embed/bhutan', '/embed/bphx', '/api/books/x/text', '/api/bphx/y']) {
      expect(isProtectedSurface('sourcelibrary.org', p)).toBe(false);
    }
    expect(isProtectedSurface('kloss.sourcelibrary.org', '/')).toBe(false);
  });

  it('leaves a deployment calling itself alone, and obeys the switch', () => {
    vi.stubEnv('VERCEL_URL', 'sourcelibrary-v2-abc.vercel.app');
    expect(isProtectedSurface('sourcelibrary-v2-abc.vercel.app', '/api/bph/books/x/index')).toBe(false);
    vi.stubEnv('BPH_BOT_GATE_ENFORCE', '0');
    expect(isProtectedSurface('bph.sourcelibrary.org', '/')).toBe(false);
  });
});

describe('surfaceRefusal', () => {
  it('passes browsers, including Chrome in a cross-site frame and the ones that send no hints', async () => {
    expect(await refusal({ 'user-agent': CHROME, 'sec-ch-ua': '"Chromium";v="151"', 'sec-ch-ua-platform': '"Windows"' })).toBeNull();
    for (const ua of [SAFARI, IPHONE, FIREFOX]) expect(await refusal({ 'user-agent': ua })).toBeNull();
  });

  it('passes link previews, our own tools and a crawler with nothing to prove', async () => {
    for (const ua of ['facebookexternalhit/1.1', 'Twitterbot/1.0', 'Slackbot-LinkExpanding 1.0', 'LinkedInBot/1.0', 'SourceLibrary-UptimeMonitor/1.0', 'BPH-Lockdown-Audit/1.0', 'Claude-User/1.0', 'nodejs-foo/1']) {
      expect(await refusal({ 'user-agent': ua })).toBeNull();
    }
  });

  it('refuses Chrome without its hints', async () => {
    expect(await refusal({ 'user-agent': CHROME })).toBe('forged-browser');
    expect(await refusal({ 'user-agent': CHROME, 'sec-ch-ua': '"x"', 'sec-ch-ua-platform': 'Windows' })).toBe('forged-browser');
  });

  it('refuses plain HTTP libraries, and no user agent at all', async () => {
    for (const ua of ['', 'python-requests/2.32', 'curl/8.5', 'Wget/1.21', 'node', 'Go-http-client/2.0', 'Scrapy/2.11', 'Mozilla/5.0']) {
      expect(isDeclaredScript(ua)).toBe(true);
      expect(await refusal({ 'user-agent': ua })).toBe('script');
    }
  });

  it('refuses a crawler name only when the address provably is not that crawler', async () => {
    const ua = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
    verdict.mockResolvedValue('verified');
    expect(await refusal({ 'user-agent': ua })).toBeNull();
    verdict.mockResolvedValue('unknown');
    expect(await refusal({ 'user-agent': ua })).toBeNull();
    verdict.mockResolvedValue('forged');
    expect(await refusal({ 'user-agent': ua })).toBe('forged-crawler');
  });
});
