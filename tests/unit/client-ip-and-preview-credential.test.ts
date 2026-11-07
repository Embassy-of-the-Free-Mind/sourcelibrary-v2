/**
 * Off Cloudflare, every header the client sends is the client's to choose.
 * Two defences on preview / deployment hosts trusted headers they should not
 * have (#7155):
 *   - the IP used for page budgets and network blocks came from
 *     `cf-connecting-ip`, so a rotated fake value meant a fresh budget per
 *     request and a way round blocked-networks.ts;
 *   - the content gate accepted any Authorization header or session cookie,
 *     so `Authorization: Bearer x` read whole books.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { encode } from 'next-auth/jwt';

vi.mock('@/lib/dataset/api-keys', () => ({
  validateApiKey: vi.fn(async (h: string | null) =>
    h === 'Bearer sl_live_good' ? { _id: 'k1', user_id: 'u1', tier: 'full' } : null),
}));

import { trustedClientIp, isCloudflareEdge } from '@/lib/client-ip';
import { hasVerifiedCredential } from '@/lib/preview-credential';
import { clientIpFromHeaders } from '@/lib/analytics-ingest';
import { getClientIp } from '@/lib/rate-limit';

describe('trustedClientIp', () => {
  it('uses cf-connecting-ip when the peer is a Cloudflare edge node (the front door)', () => {
    const h = new Headers({ 'cf-connecting-ip': '203.0.113.44', 'x-forwarded-for': '172.70.248.13' });
    expect(trustedClientIp(h)).toBe('203.0.113.44');
  });

  it('ignores cf-connecting-ip when the peer is NOT Cloudflare (a spoof on a *.vercel.app host)', () => {
    // The negative control: before #7155 this returned 198.51.100.9.
    const h = new Headers({ 'cf-connecting-ip': '198.51.100.9', 'x-forwarded-for': '81.2.69.160' });
    expect(trustedClientIp(h)).toBe('81.2.69.160');
    expect(getClientIp(new Request('https://x.test', { headers: h }))).toBe('81.2.69.160');
    expect(clientIpFromHeaders(h)).toBe('81.2.69.0');
  });

  it('ignores a spoofed true-client-ip the same way', () => {
    const h = new Headers({ 'true-client-ip': '198.51.100.9', 'x-forwarded-for': '81.2.69.160' });
    expect(trustedClientIp(h)).toBe('81.2.69.160');
  });

  it('accepts an IPv6 Cloudflare edge as the peer', () => {
    const h = new Headers({ 'cf-connecting-ip': '203.0.113.44', 'x-forwarded-for': '2a06:98c0:3600::103' });
    expect(trustedClientIp(h)).toBe('203.0.113.44');
  });

  it('falls back to cf-connecting-ip only when there is no peer header at all (dev, tests)', () => {
    expect(trustedClientIp(new Headers({ 'cf-connecting-ip': '203.0.113.7' }))).toBe('203.0.113.7');
    expect(trustedClientIp(new Headers())).toBe('unknown');
  });
});

describe('isCloudflareEdge', () => {
  it('matches published Cloudflare ranges, v4 and v6', () => {
    for (const ip of ['173.245.48.1', '104.16.0.1', '172.71.148.9', '162.158.110.3', '::ffff:172.64.0.1', '2606:4700::1', '2400:cb00:abcd::1', '2a06:98c7:ffff::1']) {
      expect(isCloudflareEdge(ip), ip).toBe(true);
    }
  });

  it('does not match real client networks or junk', () => {
    for (const ip of ['81.2.69.160', '43.172.0.1', '8.8.8.8', '2a06:98c8::1', '2001:db8::1', 'unknown', '', '999.1.1.1', '1::2::3']) {
      expect(isCloudflareEdge(ip), ip).toBe(false);
    }
  });
});

describe('hasVerifiedCredential', () => {
  const SECRET = 'test-auth-secret-at-least-32-characters-long';
  beforeAll(() => {
    process.env.AUTH_SECRET = SECRET;
    process.env.CRON_SECRET = 'cron-secret-value';
  });
  const req = (headers: Record<string, string>) =>
    new NextRequest('https://sourcelibrary-v2-git-x-dereklomas-projects.vercel.app/book/x', { headers });

  it('refuses a request with no credential', async () => {
    expect(await hasVerifiedCredential(req({}))).toBe(false);
  });

  it('refuses a fake Authorization header (the #7155 probe)', async () => {
    expect(await hasVerifiedCredential(req({ authorization: 'Bearer x' }))).toBe(false);
  });

  it('refuses a fake session cookie', async () => {
    expect(await hasVerifiedCredential(req({ cookie: '__Secure-authjs.session-token=x' }))).toBe(false);
  });

  it('refuses a session token signed with a different secret', async () => {
    const name = '__Secure-authjs.session-token';
    const token = await encode({ token: { sub: 'u1' }, secret: 'some-other-secret-that-is-also-long-enough', salt: name });
    expect(await hasVerifiedCredential(req({ cookie: `${name}=${token}` }))).toBe(false);
  });

  it('accepts a genuine session token', async () => {
    const name = '__Secure-authjs.session-token';
    const token = await encode({ token: { sub: 'u1' }, secret: SECRET, salt: name });
    expect(await hasVerifiedCredential(req({ cookie: `${name}=${token}` }))).toBe(true);
  });

  it('accepts CRON_SECRET and an active API key', async () => {
    expect(await hasVerifiedCredential(req({ authorization: 'Bearer cron-secret-value' }))).toBe(true);
    expect(await hasVerifiedCredential(req({ authorization: 'Bearer sl_live_good' }))).toBe(true);
  });
});
