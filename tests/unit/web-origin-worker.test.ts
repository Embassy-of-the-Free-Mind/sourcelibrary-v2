/**
 * The reader-origin split Worker (#8384): every routing branch, the box's request shape,
 * and the fallback to Vercel when the box is down, slow, or answers 5xx.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  BUCKET_COOKIE,
  STAFF_COOKIE,
  decide,
  handle,
  isBot,
  percentOf,
  boxRequest,
  type AnalyticsEngine,
  type Env,
} from '../../workers/web-origin/src/index';

const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const BOX = 'https://box1.sourcelibrary.org';

function env(over: Partial<Env> = {}): Env & { points: unknown[] } {
  const points: unknown[] = [];
  const METRICS: AnalyticsEngine = { writeDataPoint: (p) => void points.push(p) };
  return { PERCENT: '0', BOX_ORIGIN: BOX, BOX_SECRET: 's3cret', STAFF_TOKEN: 'staff-token-123', METRICS, points, ...over };
}

function req(path = '/book/alchemy/page/abc', init: { method?: string; cookie?: string; ua?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { 'user-agent': init.ua ?? CHROME, 'cf-connecting-ip': '198.51.100.7', ...init.headers };
  if (init.cookie) headers.cookie = init.cookie;
  return new Request(`https://sourcelibrary.org${path}`, { method: init.method ?? 'GET', headers });
}

/** A fake fetch: box URLs get `box`, anything else (the same URL, i.e. Vercel) gets `vercel`. */
function fakeFetch(box: (r: Request, init?: RequestInit) => Promise<Response>) {
  const calls: { url: string; to: 'box' | 'vercel'; req: Request }[] = [];
  const fn = vi.fn(async (input: Request | string | URL, init?: RequestInit) => {
    const r = input instanceof Request ? input : new Request(String(input));
    if (r.url.startsWith(BOX)) {
      calls.push({ url: r.url, to: 'box', req: r });
      return box(r, init);
    }
    calls.push({ url: r.url, to: 'vercel', req: r });
    return new Response('vercel page', { status: 200 });
  });
  return { fn, calls };
}
const okBox = () => fakeFetch(async () => new Response('box page', { status: 200 }));

describe('decide()', () => {
  it('PERCENT=0 (the default) sends nobody', () => {
    for (let b = 0; b < 100; b++) {
      expect(decide(req('/book/x', { cookie: `${BUCKET_COOKIE}=${b}` }), env()).target).toBe('vercel');
    }
  });

  it('a bucket under PERCENT goes to the box, at or over it stays on Vercel', () => {
    const e = env({ PERCENT: '5' });
    expect(decide(req('/book/x', { cookie: `${BUCKET_COOKIE}=4` }), e)).toMatchObject({ target: 'box', reason: 'bucket', newBucket: false });
    expect(decide(req('/book/x', { cookie: `${BUCKET_COOKIE}=5` }), e)).toMatchObject({ target: 'vercel', reason: 'bucket' });
    expect(decide(req('/book/x', { cookie: `${BUCKET_COOKIE}=99` }), env({ PERCENT: '100' })).target).toBe('box');
  });

  it('a reader with no (or a malformed) bucket gets a new one', () => {
    expect(decide(req('/book/x'), env({ PERCENT: '50' }), () => 10)).toMatchObject({ target: 'box', bucket: 10, newBucket: true });
    expect(decide(req('/book/x', { cookie: `${BUCKET_COOKIE}=abc` }), env({ PERCENT: '50' }), () => 70)).toMatchObject({ target: 'vercel', bucket: 70, newBucket: true });
    expect(decide(req('/book/x', { cookie: `${BUCKET_COOKIE}=100` }), env(), () => 3).newBucket).toBe(true);
  });

  it('PERCENT that is not a number means 0; above 100 means 100', () => {
    for (const p of [undefined, '', 'ten', '-5', 'NaN']) expect(percentOf({ PERCENT: p })).toBe(0);
    expect(percentOf({ PERCENT: '250' })).toBe(100);
    expect(percentOf({ PERCENT: '2.5' })).toBe(2.5);
  });

  it('non-GET stays on Vercel', () => {
    for (const method of ['POST', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']) {
      expect(decide(req('/book/x', { method, cookie: `${BUCKET_COOKIE}=0` }), env({ PERCENT: '100' })).reason).toBe('method');
    }
  });

  it('any session cookie stays on Vercel, even with the staff cookie', () => {
    const e = env({ PERCENT: '100' });
    for (const name of ['__Secure-authjs.session-token', 'authjs.session-token', 'next-auth.session-token', '__Secure-authjs.session-token.0']) {
      expect(decide(req('/book/x', { cookie: `${BUCKET_COOKIE}=0; ${name}=jwt` }), e).reason, name).toBe('session');
      expect(decide(req('/book/x', { cookie: `${STAFF_COOKIE}=staff-token-123; ${name}=jwt` }), e).reason).toBe('session');
    }
    // A cookie that merely mentions the words is not a session.
    expect(decide(req('/book/x', { cookie: `${BUCKET_COOKIE}=0; theme=session-token-ish` }), e).target).toBe('box');
  });

  it('known bots stay on Vercel unless INCLUDE_BOTS=1', () => {
    const bots = ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'curl/8.4.0', 'python-requests/2.31', 'GPTBot/1.1', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0)', '', 'x'];
    for (const ua of bots) {
      expect(isBot(ua), ua).toBe(true);
      expect(decide(req('/book/x', { ua, cookie: `${BUCKET_COOKIE}=0` }), env({ PERCENT: '100' })).reason).toBe('bot');
      expect(decide(req('/book/x', { ua, cookie: `${BUCKET_COOKIE}=0` }), env({ PERCENT: '100', INCLUDE_BOTS: '1' })).target).toBe('box');
    }
    expect(isBot(CHROME)).toBe(false);
    expect(isBot(IPHONE)).toBe(false);
  });

  it('stage 0: the staff cookie sends staff at PERCENT=0; a wrong token does not', () => {
    expect(decide(req('/book/x', { cookie: `${STAFF_COOKIE}=staff-token-123` }), env())).toMatchObject({ target: 'box', reason: 'staff' });
    expect(decide(req('/book/x', { cookie: `${STAFF_COOKIE}=staff-token-12` }), env()).target).toBe('vercel');
    expect(decide(req('/book/x', { cookie: `${STAFF_COOKIE}=anything` }), env({ STAFF_TOKEN: undefined })).target).toBe('vercel');
  });

  it('only /book and /book/* are eligible', () => {
    const e = env({ PERCENT: '100' });
    expect(decide(req('/book', { cookie: `${BUCKET_COOKIE}=0` }), e).target).toBe('box');
    for (const p of ['/books', '/bookmarks', '/api/books/x', '/collections/alchemy', '/']) {
      expect(decide(req(p, { cookie: `${BUCKET_COOKIE}=0` }), e).reason, p).toBe('path');
    }
  });

  it('without BOX_ORIGIN or BOX_SECRET nothing goes to the box', () => {
    expect(decide(req('/book/x', { cookie: `${STAFF_COOKIE}=staff-token-123` }), env({ BOX_SECRET: '' })).reason).toBe('unconfigured');
    expect(decide(req('/book/x', { cookie: `${STAFF_COOKIE}=staff-token-123` }), env({ BOX_ORIGIN: undefined })).reason).toBe('unconfigured');
  });
});

describe('boxRequest()', () => {
  it('keeps path and query, adds the secret and the reader identity, never follows redirects', () => {
    const r = req('/book/alchemy/page/abc?lang=en&_rsc=1', {
      headers: { 'cf-ipcountry': 'NL', 'x-sl-client-ip': '6.6.6.6' },
      cookie: `${BUCKET_COOKIE}=1`,
    });
    const b = boxRequest(r, env());
    expect(b.url).toBe(`${BOX}/book/alchemy/page/abc?lang=en&_rsc=1`);
    expect(b.headers.get('x-sl-origin-secret')).toBe('s3cret');
    expect(b.headers.get('x-sl-client-ip')).toBe('198.51.100.7'); // client-sent value overwritten
    expect(b.headers.get('x-sl-client-country')).toBe('NL');
    expect(b.headers.get('cookie')).toBe(`${BUCKET_COOKIE}=1`);
    expect(b.redirect).toBe('manual');
  });
});

describe('handle()', () => {
  it('Vercel path: the request is passed through untouched and counted', async () => {
    const e = env();
    const { fn, calls } = okBox();
    const r = req('/book/x', { cookie: `${BUCKET_COOKIE}=50` });
    const res = await handle(r, e, fn);
    expect(await res.text()).toBe('vercel page');
    expect(calls).toHaveLength(1);
    expect(calls[0].req).toBe(r);
    expect(res.headers.get('x-sl-origin')).toBe('vercel');
    expect(e.points).toEqual([expect.objectContaining({ blobs: ['vercel', 'bucket', 'page'] })]);
  });

  it('box path: served by the box, sticky bucket cookie set for a new reader', async () => {
    const e = env({ PERCENT: '100' });
    const { fn, calls } = okBox();
    const res = await handle(req('/book/x'), e, fn);
    expect(await res.text()).toBe('box page');
    expect(calls.map((c) => c.to)).toEqual(['box']);
    expect(res.headers.get('x-sl-origin')).toBe('box');
    expect(res.headers.get('set-cookie')).toMatch(new RegExp(`^${BUCKET_COOKIE}=\\d{1,2}; Path=/; Max-Age=2592000; Secure; SameSite=Lax$`));
    expect(e.points).toEqual([expect.objectContaining({ blobs: ['box', 'bucket', 'page'] })]);
  });

  it('a reader who already has a bucket gets no new cookie', async () => {
    const { fn } = okBox();
    const res = await handle(req('/book/x', { cookie: `${BUCKET_COOKIE}=3` }), env({ PERCENT: '10' }), fn);
    expect(res.headers.get('x-sl-origin')).toBe('box');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('bots and signed-in readers get no bucket cookie', async () => {
    const { fn } = okBox();
    const bot = await handle(req('/book/x', { ua: 'Googlebot/2.1' }), env({ PERCENT: '10' }), fn);
    expect(bot.headers.get('set-cookie')).toBeNull();
    const signed = await handle(req('/book/x', { cookie: '__Secure-authjs.session-token=jwt' }), env({ PERCENT: '10' }), fn);
    expect(signed.headers.get('set-cookie')).toBeNull();
  });

  it('box redirects are passed to the reader, not followed', async () => {
    const { fn } = fakeFetch(async () => new Response(null, { status: 301, headers: { location: 'https://sourcelibrary.org/book/slug' } }));
    const res = await handle(req('/book/0123456789abcdef01234567', { cookie: `${BUCKET_COOKIE}=0` }), env({ PERCENT: '1' }), fn);
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://sourcelibrary.org/book/slug');
    expect(res.headers.get('x-sl-origin')).toBe('box');
  });

  it('box 404 is a real answer, not a fallback', async () => {
    const e = env({ PERCENT: '100' });
    const { fn, calls } = fakeFetch(async () => new Response('nf', { status: 404 }));
    const res = await handle(req('/book/nope', { cookie: `${BUCKET_COOKIE}=0` }), e, fn);
    expect(res.status).toBe(404);
    expect(calls.map((c) => c.to)).toEqual(['box']);
  });

  it('box down (network error): retried on Vercel and counted', async () => {
    const e = env({ PERCENT: '100' });
    const { fn, calls } = fakeFetch(async () => {
      throw new TypeError('connect ECONNREFUSED');
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await handle(req('/book/x', { cookie: `${BUCKET_COOKIE}=0` }), e, fn);
    log.mockRestore();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('vercel page');
    expect(calls.map((c) => c.to)).toEqual(['box', 'vercel']);
    expect(res.headers.get('x-sl-origin')).toBe('vercel-fallback');
    expect(e.points).toEqual([expect.objectContaining({ blobs: ['fallback', 'network', 'page'] })]);
  });

  it.each([500, 502, 503, 504])('box %i: retried on Vercel and counted', async (status) => {
    const e = env({ PERCENT: '100' });
    const { fn, calls } = fakeFetch(async () => new Response('err', { status }));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await handle(req('/book/x', { cookie: `${BUCKET_COOKIE}=0` }), e, fn);
    vi.restoreAllMocks();
    expect(await res.text()).toBe('vercel page');
    expect(calls.map((c) => c.to)).toEqual(['box', 'vercel']);
    expect(e.points).toEqual([expect.objectContaining({ blobs: ['fallback', `status_${status}`, 'page'] })]);
  });

  it('box slow (no headers within BOX_TIMEOUT_MS): aborted, retried on Vercel, counted', async () => {
    vi.useFakeTimers();
    const e = env({ PERCENT: '100' });
    let aborted = false;
    const { fn, calls } = fakeFetch((_r, init) => new Promise<Response>((resolve) => {
      init?.signal?.addEventListener('abort', () => { aborted = true; });
      setTimeout(() => resolve(new Response('late box page')), 10_000);
    }));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const pending = handle(req('/book/x', { cookie: `${BUCKET_COOKIE}=0` }), e, fn);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(calls.map((c) => c.to)).toEqual(['box']);
    await vi.advanceTimersByTimeAsync(2);
    const res = await pending;
    vi.useRealTimers();
    vi.restoreAllMocks();
    expect(aborted).toBe(true);
    expect(await res.text()).toBe('vercel page');
    expect(calls.map((c) => c.to)).toEqual(['box', 'vercel']);
    expect(res.headers.get('x-sl-origin')).toBe('vercel-fallback');
    expect(e.points).toEqual([expect.objectContaining({ blobs: ['fallback', 'timeout', 'page'] })]);
  });

  it('a box that answers just inside the deadline is served', async () => {
    vi.useFakeTimers();
    const { fn, calls } = fakeFetch(() => new Promise<Response>((resolve) => setTimeout(() => resolve(new Response('box page')), 2_900)));
    const pending = handle(req('/book/x', { cookie: `${BUCKET_COOKIE}=0` }), env({ PERCENT: '100' }), fn);
    await vi.advanceTimersByTimeAsync(2_900);
    const res = await pending;
    vi.useRealTimers();
    expect(await res.text()).toBe('box page');
    expect(calls.map((c) => c.to)).toEqual(['box']);
  });

  it('BOX_TIMEOUT_MS is honoured', async () => {
    vi.useFakeTimers();
    const { fn, calls } = fakeFetch(() => new Promise<Response>(() => {}));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const pending = handle(req('/book/x', { cookie: `${BUCKET_COOKIE}=0` }), env({ PERCENT: '100', BOX_TIMEOUT_MS: '500' }), fn);
    await vi.advanceTimersByTimeAsync(501);
    const res = await pending;
    vi.useRealTimers();
    vi.restoreAllMocks();
    expect(res.headers.get('x-sl-origin')).toBe('vercel-fallback');
    expect(calls.map((c) => c.to)).toEqual(['box', 'vercel']);
  });

  it('a metrics failure never fails the request', async () => {
    const e = env({ PERCENT: '100', METRICS: { writeDataPoint: () => { throw new Error('ae down'); } } });
    const { fn } = okBox();
    const res = await handle(req('/book/x', { cookie: `${BUCKET_COOKIE}=0` }), e, fn);
    expect(res.status).toBe(200);
  });

  describe('/_box/* assets', () => {
    it('always go to the box (no bucket needed), with the secret', async () => {
      const e = env();
      const { fn, calls } = fakeFetch(async () => new Response('css', { status: 200, headers: { 'content-type': 'text/css' } }));
      const res = await handle(req('/_box/_next/static/chunks/a.css', { ua: 'Googlebot/2.1' }), e, fn);
      expect(await res.text()).toBe('css');
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(`${BOX}/_box/_next/static/chunks/a.css`);
      expect(calls[0].req.headers.get('x-sl-origin-secret')).toBe('s3cret');
      expect(res.headers.get('set-cookie')).toBeNull();
    });

    it('box down: a counted 502, not a Vercel page', async () => {
      const e = env();
      const { fn, calls } = fakeFetch(async () => { throw new TypeError('down'); });
      const res = await handle(req('/_box/_next/static/chunks/a.js'), e, fn);
      expect(res.status).toBe(502);
      expect(calls.map((c) => c.to)).toEqual(['box']);
      expect(e.points).toEqual([expect.objectContaining({ blobs: ['fallback', 'network', 'asset'] })]);
    });

    it('unconfigured: passed through to Vercel', async () => {
      const { fn, calls } = okBox();
      await handle(req('/_box/_next/static/chunks/a.js'), env({ BOX_SECRET: undefined }), fn);
      expect(calls.map((c) => c.to)).toEqual(['vercel']);
    });
  });
});
