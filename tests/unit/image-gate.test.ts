import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * Image-proxy gate (#4356). Pins the ladder that keeps four very different
 * consumers working while anonymous bulk extraction is budgeted:
 *   - reader browsers (never gated, never logged — the hot path)
 *   - our own server-side fetchers (exports/OCR/MCP), via the itk signature
 *   - API keys: paid tiers uncapped, Explorer capped — attributable either way
 *   - social-card scrapers and trusted bots (link previews must not die)
 * The day-one failure this prevents: a full-tier partner pulling 3,000+
 * images/day read as an anonymous bot, throttled, and counted nowhere.
 */

vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => null) }));
vi.mock('@/lib/dataset/api-keys', () => ({
  validateApiKey: vi.fn(async () => null),
  checkKeyRequestRate: vi.fn(() => ({ allowed: true })),
}));
vi.mock('@/lib/bot-gate', () => ({ isTrustedBot: vi.fn(async () => false) }));
vi.mock('@/lib/api-usage', () => ({
  getPagesServedLast24h: vi.fn(async () => 0),
  logApiUsage: vi.fn(),
}));

import { auth } from '@/lib/auth';
import { validateApiKey } from '@/lib/dataset/api-keys';
import { isTrustedBot } from '@/lib/bot-gate';
import { getPagesServedLast24h } from '@/lib/api-usage';
import {
  checkImageAccess,
  isBrowserShapedImageRequest,
  isSocialCardScraper,
  imageBudgetExceededBody,
} from '@/lib/image-gate';
import { signImageProxyUrl, verifyImageProxyToken } from '@/lib/image-proxy-auth';

function req(input: {
  headers?: Record<string, string>;
  url?: string;
}): NextRequest {
  const url = new URL(input.url || 'https://sourcelibrary.org/api/image?url=https%3A%2F%2Fimages.sourcelibrary.org%2Farchived%2Fb1%2F1.jpg&w=400');
  return {
    headers: new Headers(input.headers || {}),
    nextUrl: url,
    url: url.toString(),
    method: 'GET',
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue(null as never);
  vi.mocked(validateApiKey).mockResolvedValue(null as never);
  vi.mocked(isTrustedBot).mockResolvedValue(false);
  vi.mocked(getPagesServedLast24h).mockResolvedValue(0);
  process.env.IMAGE_PROXY_SIGNING_SECRET = 'test-secret';
  delete process.env.IMAGE_GATE_ENFORCE;
});

afterEach(() => {
  delete process.env.IMAGE_PROXY_SIGNING_SECRET;
  delete process.env.IMAGE_GATE_ENFORCE;
});

describe('browser-shaped detection (the never-gate-readers invariant)', () => {
  it('passes any Sec-Fetch-Dest subresource load, including cross-site hotlinks and IIIF viewers', () => {
    for (const dest of ['image', 'document', 'iframe', 'embed', 'object']) {
      expect(isBrowserShapedImageRequest(req({ headers: { 'sec-fetch-dest': dest } }))).toBe(true);
    }
  });

  it('does NOT pass fetch/XHR (sec-fetch-dest: empty) without an own-site referer', () => {
    expect(isBrowserShapedImageRequest(req({ headers: { 'sec-fetch-dest': 'empty' } }))).toBe(false);
  });

  it('passes own-property referers on a dot boundary, including tenant subdomains and previews', () => {
    for (const ref of [
      'https://sourcelibrary.org/book/x',
      'https://bph.sourcelibrary.org/book/x',
      'https://ficinosociety.org/',
      'https://sourcelibrary-v2-abc.vercel.app/book/x',
      'http://localhost:3000/book/x',
    ]) {
      expect(isBrowserShapedImageRequest(req({ headers: { referer: ref } }))).toBe(true);
    }
  });

  it('rejects lookalike referer hosts (no bare suffix match — the #3508 hole)', () => {
    expect(isBrowserShapedImageRequest(req({ headers: { referer: 'https://evilsourcelibrary.org/' } }))).toBe(false);
  });
});

describe('internal signature (itk)', () => {
  it('signs own-host /api/image URLs and round-trips verification', () => {
    const signed = signImageProxyUrl('https://sourcelibrary.org/api/image?url=https%3A%2F%2Farchive.org%2Fx.jpg&w=500');
    const u = new URL(signed);
    const itk = u.searchParams.get('itk');
    expect(itk).toBeTruthy();
    expect(verifyImageProxyToken(u.searchParams.get('url')!, itk)).toBe(true);
    expect(verifyImageProxyToken(u.searchParams.get('url')!, itk + '0')).toBe(false);
    expect(verifyImageProxyToken('https://other.example/x.jpg', itk)).toBe(false);
  });

  it('leaves non-proxy and foreign-host URLs untouched', () => {
    const external = 'https://archive.org/download/x/page.jpg';
    expect(signImageProxyUrl(external)).toBe(external);
    const foreign = 'https://evil.example/api/image?url=x';
    expect(signImageProxyUrl(foreign)).toBe(foreign);
  });

  it('a validly signed request passes as internal, unlogged', async () => {
    const signed = signImageProxyUrl('https://sourcelibrary.org/api/image?url=https%3A%2F%2Farchive.org%2Fx.jpg&w=500');
    const decision = await checkImageAccess(req({ url: signed }));
    expect(decision.allowed).toBe(true);
    expect(decision.identity.kind).toBe('internal');
    expect(decision.shouldLog).toBe(false);
  });
});

describe('API keys — the sanctioned, attributable bulk path', () => {
  it('paid tiers are uncapped and logged', async () => {
    vi.mocked(validateApiKey).mockResolvedValue({ _id: 'k1', user_id: 'u1', tier: 'full' } as never);
    vi.mocked(getPagesServedLast24h).mockResolvedValue(1_000_000);
    const decision = await checkImageAccess(req({ headers: { authorization: 'Bearer sl_data_x' } }));
    expect(decision.allowed).toBe(true);
    expect(decision.identity.kind).toBe('apikey');
    expect(decision.shouldLog).toBe(true);
  });

  it('free Explorer keys hit their tier cap with a 429 and an upgrade pitch', async () => {
    vi.mocked(validateApiKey).mockResolvedValue({ _id: 'k1', user_id: 'u1', tier: 'explorer' } as never);
    vi.mocked(getPagesServedLast24h).mockResolvedValue(2000);
    const decision = await checkImageAccess(req({ headers: { authorization: 'Bearer sl_data_x' } }));
    expect(decision.allowed).toBe(false);
    expect(decision.status).toBe(429);
    expect(imageBudgetExceededBody(decision).error).toContain('licensing');
  });

  it('an invalid key demotes to anonymous, not to a free pass', async () => {
    vi.mocked(getPagesServedLast24h).mockResolvedValue(9999);
    const decision = await checkImageAccess(req({ headers: { authorization: 'Bearer sl_data_forged' } }));
    expect(decision.allowed).toBe(false);
    expect(decision.identity.kind).toBe('anon');
  });
});

describe('bots and scrapers', () => {
  it('social-card scrapers pass the image gate (link previews must render)', async () => {
    const r = req({ headers: { 'user-agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)' } });
    expect(isSocialCardScraper(r)).toBe(true);
    const decision = await checkImageAccess(r);
    expect(decision.allowed).toBe(true);
    expect(decision.shouldLog).toBe(false);
  });

  it('trusted bots (search crawlers, assistant user-fetch agents) pass', async () => {
    vi.mocked(isTrustedBot).mockResolvedValue(true);
    const decision = await checkImageAccess(req({}));
    expect(decision.allowed).toBe(true);
    expect(decision.identity.kind).toBe('bot');
  });
});

describe('anonymous non-browser traffic — the mass-download budget', () => {
  it('serves and logs under the daily budget', async () => {
    vi.mocked(getPagesServedLast24h).mockResolvedValue(10);
    const decision = await checkImageAccess(req({}));
    expect(decision.allowed).toBe(true);
    expect(decision.identity.kind).toBe('anon');
    expect(decision.shouldLog).toBe(true);
  });

  it('429s over the budget with the get-a-key funnel body', async () => {
    vi.mocked(getPagesServedLast24h).mockResolvedValue(500);
    const decision = await checkImageAccess(req({}));
    expect(decision.allowed).toBe(false);
    expect(decision.status).toBe(429);
    const body = imageBudgetExceededBody(decision);
    expect(body.next_steps.get_api_key).toContain('developers');
    expect(body.error).toContain('API key');
  });

  it('IMAGE_GATE_ENFORCE=0 turns blocking off but keeps the would-block reason (log-only rollback)', async () => {
    process.env.IMAGE_GATE_ENFORCE = '0';
    vi.mocked(getPagesServedLast24h).mockResolvedValue(5000);
    const decision = await checkImageAccess(req({}));
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('image_budget_anon');
    expect(decision.shouldLog).toBe(true);
  });
});
