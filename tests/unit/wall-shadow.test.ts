import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The shadow wall (#90) must observe only: with METERED_READER off, a reader gets every
 * page back unchanged, and the log says what the wall would have done. The cases that
 * matter most are the ones the wall would decide differently: a signed-in reader and a
 * page inside the free sample write nothing, a forged assistant name is logged as
 * unproven, the real one as a pass.
 */
const session = vi.hoisted(() => ({ user: null as null | { id: string } }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => (session.user ? { user: session.user } : null)) }));
vi.mock('@/lib/dataset/api-keys', () => ({ validateApiKey: async () => null, checkKeyRequestRate: () => ({ allowed: true }) }));
vi.mock('@/lib/crawler-verify', async (orig) => ({
  ...(await orig<typeof import('@/lib/crawler-verify')>()),
  verifyCrawlerClaim: async () => 'forged',
}));

import { gatePagesForRequest } from '@/lib/metered-gate';
import { callerSampled, classifyShadowCaller, wallShadowEnabled, WALL_SHADOW_COLLECTION } from '@/lib/wall-shadow';

const CONNECTOR_IP = '160.79.104.10';
const CLAUDE = 'Mozilla/5.0 (compatible; Claude-User/1.0; +Claude-User@anthropic.com)';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0 Safari/537.36';

function req(ua: string, ip = '203.0.113.7', extra: Record<string, string> = {}) {
  return new Request('https://sourcelibrary.org/api/pages/p50', {
    headers: { 'user-agent': ua, 'x-forwarded-for': ip, host: 'sourcelibrary.org', ...extra },
  });
}

type Doc = Record<string, unknown>;
let inserted: Doc[];
const db = {
  collection: (name: string) => ({
    find: () => ({ toArray: async () => (name === 'books' ? [{ id: 'b1', pages_count: 100 }] : []) }),
    insertOne: async (d: Doc) => { if (name === WALL_SHADOW_COLLECTION) inserted.push(d); return {}; },
    createIndex: async () => 'ts_1',
  }),
} as unknown as import('mongodb').Db;

const deep = () => [{ book_id: 'b1', page_number: 50, ocr: { data: 'text' } }];
const free = () => [{ book_id: 'b1', page_number: 5, ocr: { data: 'text' } }];
const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  inserted = [];
  session.user = null;
  vi.stubEnv('METERED_READER', '');
  vi.stubEnv('WALL_SHADOW_SAMPLE', '1');
  vi.stubEnv('WALL_SHADOW_UNTIL', '2099-01-01');
});
afterEach(() => vi.unstubAllEnvs());

describe('shadow wall: observe only', () => {
  it('returns every page unchanged and logs what the wall would strip', async () => {
    const pages = deep();
    const out = await gatePagesForRequest(db, req(CHROME, '203.0.113.7', { 'sec-fetch-mode': 'cors' }), pages);
    expect(out).toBe(pages);
    expect(out[0].ocr).toEqual({ data: 'text' });
    await settle();
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ kind: 'anon_browser', action: 'would_strip', pages_past_sample: 1, free_max_page: 20, book_id: 'b1' });
  });

  it('writes nothing for a page inside the free sample', async () => {
    await gatePagesForRequest(db, req(CHROME), free());
    await settle();
    expect(inserted).toHaveLength(0);
  });

  it('writes nothing for a signed-in reader, the pipeline, or a tenant room', async () => {
    session.user = { id: 'u1' };
    await gatePagesForRequest(db, req(CHROME), deep());
    session.user = null;
    vi.stubEnv('CRON_SECRET', 'cron-test');
    await gatePagesForRequest(db, req('node', '203.0.113.7', { authorization: 'Bearer cron-test' }), deep());
    await gatePagesForRequest(db, req(CHROME), deep(), { exempt: true });
    await settle();
    expect(inserted).toHaveLength(0);
  });

  it('is silent when switched off, past its end date, or when the real wall is on', () => {
    expect(wallShadowEnabled()).toBe(true);
    vi.stubEnv('WALL_SHADOW', 'off');
    expect(wallShadowEnabled()).toBe(false);
    vi.stubEnv('WALL_SHADOW', '');
    vi.stubEnv('WALL_SHADOW_UNTIL', '2026-01-01');
    expect(wallShadowEnabled(new Date('2026-06-01'))).toBe(false);
    vi.stubEnv('WALL_SHADOW_UNTIL', '2099-01-01');
    vi.stubEnv('METERED_READER', '1');
    expect(wallShadowEnabled()).toBe(false);
  });
});

describe('shadow wall: who the caller is', () => {
  it('checks an assistant by its operator\'s network, not by its name', async () => {
    expect(await classifyShadowCaller(req(CLAUDE, CONNECTOR_IP))).toEqual({ kind: 'assistant_proven', action: 'pass' });
    expect(await classifyShadowCaller(req(CLAUDE, '203.0.113.7'))).toEqual({ kind: 'assistant_unproven', action: 'would_strip' });
  });

  it('separates a forged crawler, a declared bot, a browser and a plain script', async () => {
    expect((await classifyShadowCaller(req('Mozilla/5.0 (compatible; Googlebot/2.1)')))?.kind).toBe('crawler_name_unproven');
    expect((await classifyShadowCaller(req('Mozilla/5.0 (compatible; GPTBot/1.2)')))?.kind).toBe('declared_bot');
    expect((await classifyShadowCaller(req(CHROME, '203.0.113.7', { 'sec-ch-ua': '"Chromium";v="150"' })))?.kind).toBe('anon_browser');
    expect((await classifyShadowCaller(req('python-requests/2.32')))?.kind).toBe('anon_script');
  });
});

describe('shadow wall: sampling by caller', () => {
  it('keeps or drops a caller for the whole day, at about the set rate', () => {
    const day = '2026-11-20';
    expect(callerSampled('abc', day, 0.25)).toBe(callerSampled('abc', day, 0.25));
    let kept = 0;
    for (let i = 0; i < 4000; i++) if (callerSampled(`ip${i}`, day, 0.25)) kept++;
    expect(kept / 4000).toBeGreaterThan(0.22);
    expect(kept / 4000).toBeLessThan(0.28);
    expect(callerSampled('abc', day, 0)).toBe(false);
    expect(callerSampled('abc', day, 1)).toBe(true);
  });
});
