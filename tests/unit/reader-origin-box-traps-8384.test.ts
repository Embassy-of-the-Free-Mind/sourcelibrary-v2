/**
 * Traps 1 and 2 of the staged traffic test (#8384): both must be inert on Vercel.
 *
 * - Trap 1: `SL_ASSET_PREFIX` sets next.config `assetPrefix` (and, for an absolute prefix,
 *   the CSP origins). Unset, the config and its CSP header are byte-identical.
 * - Trap 2: `SL_BOX_CLIENT_IDENTITY=cloudflare` makes the client IP and country come from
 *   `cf-connecting-ip` / `cf-ipcountry` only. Unset, both functions return what the code
 *   returned before this change, for every header combination below.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assetPrefixFromEnv, withAssetOrigin } from '@/lib/asset-prefix';
import { clientCountry, isCloudflareEdge, onReaderOriginBox, trustedClientIp } from '@/lib/client-ip';

vi.mock('@posthog/nextjs-config', () => ({ withPostHogConfig: (c: unknown) => c }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

// The pre-#8384 bodies, verbatim, as the oracle for "Vercel behaviour unchanged".
function oldTrustedClientIp(headers: Headers): string {
  const peer =
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip')?.trim() ||
    '';
  const viaCdn = headers.get('cf-connecting-ip')?.trim() || headers.get('true-client-ip')?.trim() || '';
  if (!peer) return viaCdn || 'unknown';
  if (isCloudflareEdge(peer)) return viaCdn || peer;
  return peer;
}
function oldCountry(headers: Headers): string | null {
  return headers.get('x-vercel-ip-country') || headers.get('cf-ipcountry') || null;
}

const CASES: Record<string, string>[] = [
  {},
  { 'x-forwarded-for': '203.0.113.9' },
  { 'x-forwarded-for': '172.70.1.2', 'cf-connecting-ip': '198.51.100.7' }, // via Cloudflare
  { 'x-forwarded-for': '203.0.113.9', 'cf-connecting-ip': '198.51.100.7' }, // forged cf header
  { 'x-real-ip': '203.0.113.10', 'true-client-ip': '198.51.100.8' },
  { 'cf-connecting-ip': '198.51.100.7' },
  { 'x-forwarded-for': '2606:4700::1, 10.0.0.1', 'cf-connecting-ip': '2001:db8::5' },
  { 'x-vercel-ip-country': 'NL', 'cf-ipcountry': 'DE' },
  { 'cf-ipcountry': 'DE' },
  { 'x-vercel-ip-country': 'US' },
  { 'x-vercel-ip-country': '', 'cf-ipcountry': 'FR', 'x-forwarded-for': '172.64.0.9' },
];

describe('trap 2: client identity', () => {
  it('is off unless SL_BOX_CLIENT_IDENTITY=cloudflare', () => {
    expect(onReaderOriginBox()).toBe(false);
    vi.stubEnv('SL_BOX_CLIENT_IDENTITY', '1');
    expect(onReaderOriginBox()).toBe(false);
    vi.stubEnv('SL_BOX_CLIENT_IDENTITY', 'cloudflare');
    expect(onReaderOriginBox()).toBe(true);
  });

  it.each(CASES.map((c) => [JSON.stringify(c), c]))('unset: unchanged for %s', (_, h) => {
    const headers = new Headers(h);
    expect(trustedClientIp(headers)).toBe(oldTrustedClientIp(headers));
    expect(clientCountry(headers)).toBe(oldCountry(headers));
  });

  it('on the box: IP and country come from the Cloudflare headers only', () => {
    vi.stubEnv('SL_BOX_CLIENT_IDENTITY', 'cloudflare');
    const forged = new Headers({
      'x-forwarded-for': '203.0.113.9',
      'x-real-ip': '203.0.113.10',
      'true-client-ip': '203.0.113.11',
      'x-vercel-ip-country': 'KP',
      'cf-connecting-ip': '198.51.100.7',
      'cf-ipcountry': 'NL',
    });
    expect(trustedClientIp(forged)).toBe('198.51.100.7');
    expect(clientCountry(forged)).toBe('NL');
  });

  it('on the box: missing Cloudflare headers mean unknown, never a client-written value', () => {
    vi.stubEnv('SL_BOX_CLIENT_IDENTITY', 'cloudflare');
    const h = new Headers({ 'x-forwarded-for': '203.0.113.9', 'x-vercel-ip-country': 'KP' });
    expect(trustedClientIp(h)).toBe('unknown');
    expect(clientCountry(h)).toBeNull();
  });
});

describe('trap 1: asset prefix', () => {
  it('unset or blank: no prefix, no CSP origin', () => {
    expect(assetPrefixFromEnv(undefined)).toEqual({ assetPrefix: undefined, cspOrigin: null });
    expect(assetPrefixFromEnv('  ')).toEqual({ assetPrefix: undefined, cspOrigin: null });
  });

  it('a same-origin path needs no CSP change', () => {
    expect(assetPrefixFromEnv('/_box')).toEqual({ assetPrefix: '/_box', cspOrigin: null });
    expect(assetPrefixFromEnv('/_box/')).toEqual({ assetPrefix: '/_box', cspOrigin: null });
  });

  it('an absolute https prefix adds its origin to the asset directives only', () => {
    const a = assetPrefixFromEnv('https://box1.sourcelibrary.org/');
    expect(a).toEqual({ assetPrefix: 'https://box1.sourcelibrary.org', cspOrigin: 'https://box1.sourcelibrary.org' });
    expect(withAssetOrigin("script-src 'self'", a.cspOrigin)).toBe("script-src 'self' https://box1.sourcelibrary.org");
    expect(withAssetOrigin("font-src 'self'", a.cspOrigin)).toBe("font-src 'self' https://box1.sourcelibrary.org");
    expect(withAssetOrigin("img-src 'self'", a.cspOrigin)).toBe("img-src 'self'");
    expect(withAssetOrigin("script-src 'self'", null)).toBe("script-src 'self'");
  });

  it('refuses anything else loudly, at build time', () => {
    for (const bad of ['http://box1.sourcelibrary.org', '//evil.example', 'box1', 'https://x.org/?a=1', 'javascript:alert(1)']) {
      expect(() => assetPrefixFromEnv(bad), bad).toThrow(/SL_ASSET_PREFIX/);
    }
  });

  async function loadConfig() {
    vi.resetModules();
    const mod = await import('../../next.config');
    const config = mod.default as { assetPrefix?: string; headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]> };
    const rules = await config.headers();
    const csp = rules.find((r) => r.source === '/(.*)')?.headers.find((h) => h.key === 'Content-Security-Policy')?.value;
    return { assetPrefix: config.assetPrefix, csp, rules };
  }

  it('next.config: unset leaves assetPrefix and every header rule untouched; set changes only those', async () => {
    const vercel = await loadConfig();
    expect(vercel.assetPrefix).toBeUndefined();
    expect(vercel.csp).toMatch(/script-src 'self' /);

    vi.stubEnv('SL_ASSET_PREFIX', '/_box');
    const box = await loadConfig();
    expect(box.assetPrefix).toBe('/_box');
    expect(box.rules).toEqual(vercel.rules); // same-origin path: CSP identical

    vi.stubEnv('SL_ASSET_PREFIX', 'https://box1.sourcelibrary.org');
    const abs = await loadConfig();
    expect(abs.assetPrefix).toBe('https://box1.sourcelibrary.org');
    expect(abs.csp).toContain("font-src 'self' https://fonts.gstatic.com https://box1.sourcelibrary.org");
    expect(abs.csp?.replaceAll(' https://box1.sourcelibrary.org', '')).toBe(vercel.csp);
  });
});
