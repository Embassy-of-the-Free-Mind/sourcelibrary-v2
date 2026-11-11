import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/**
 * /book/<slug>/search/text gives an assistant one book's passages as HTML (#8161).
 * The risks: an injection through the query or stored text, training crawlers
 * reading it, a partner subdomain gaining a page that links to the whole library,
 * searching by slug where the pages carry the id, and paging through a whole book.
 */
const state = vi.hoisted(() => ({
  urls: [] as string[],
  ids: [] as string[],
  gated: [] as string[],
  status: 200,
  book: null as Record<string, unknown> | null,
  results: [] as Record<string, unknown>[],
  total: 0,
}));

vi.mock('@/app/api/books/[id]/search/route', () => ({
  GET: async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    state.urls.push(req.url);
    state.ids.push((await ctx.params).id);
    if (state.status !== 200) return NextResponse.json({ error: 'nope' }, { status: state.status });
    return NextResponse.json({ total: state.total, returned: state.results.length, results: state.results });
  },
}));
// No importOriginal: the real module loads next-auth, which vitest cannot resolve.
vi.mock('@/lib/api-auth', () => ({
  withApiAuth: (handler: (...a: unknown[]) => unknown, opts: { route: string }) => {
    state.gated.push(opts.route);
    return handler;
  },
}));
vi.mock('@/lib/mongodb', async (orig) => {
  const fakeDb = {
    collection: () => ({
      findOne: async (filter: { $or?: Array<Record<string, string>> }) => {
        const b = state.book;
        if (!b || !filter.$or) return null;
        return filter.$or.some((c) => Object.entries(c).every(([k, v]) => b[k] === v)) ? b : null;
      },
    }),
  };
  return { ...(await orig<typeof import('@/lib/mongodb')>()), getReadDb: async () => fakeDb };
});
vi.mock('@/lib/dataset/api-keys', () => ({ validateApiKey: async () => null }));
vi.mock('@/lib/crawler-verify', () => ({ provableClaimIn: () => null, verifyCrawlerClaim: async () => 'unknown' }));

import { GET } from '@/app/book/[id]/search/text/route';
import { GET as robots } from '@/app/robots.txt/route';
import { proxy } from '@/proxy';
import { isGlobalOnlyTenantPath } from '@/lib/tenant-global-paths';

const CLAUDE = 'Mozilla/5.0 (compatible; Claude-User/1.0; +Claude-User@anthropic.com)';
const ANTHROPIC_IP = '160.79.104.10';

const call = (q: string | null, { ua = CLAUDE, book = 'de-secretis', headers = {} as Record<string, string>, extra = '' } = {}) => GET(
  new NextRequest(
    `https://sourcelibrary.org/book/${book}/search/text${q === null ? '' : `?q=${encodeURIComponent(q)}`}${extra}`,
    // A real Claude-User arrives from Anthropic's published range (#4357).
    { headers: { 'user-agent': ua, 'x-forwarded-for': ANTHROPIC_IP, ...headers } },
  ),
  { params: Promise.resolve({ id: book }) },
);

beforeEach(() => {
  state.urls = [];
  state.ids = [];
  state.status = 200;
  state.book = { id: 'b1', slug: 'de-secretis', title: 'De secretis', display_title: 'On Secrets', author: 'Suchten', published: '1570' };
  state.results = [
    { pageId: 'p99', pageNumber: 99, matches: [{ field: 'translation', snippet: '...the Archeus works in the stomach...' }, { field: 'ocr', snippet: '...Archeus in stomacho...' }] },
    { pageId: 'p12', pageNumber: 12, is_front_matter: true, matches: [{ field: 'ocr', snippet: 'Archeus' }] },
  ];
  state.total = 2;
});

describe('who reaches it', () => {
  const req = (url: string, ua: string) => new NextRequest(url, {
    headers: { host: new URL(url).host, 'user-agent': ua, 'accept-language': 'en', 'sec-fetch-mode': 'navigate' },
  });

  it('is refused on a partner subdomain', async () => {
    const res = await proxy(req('https://bph.sourcelibrary.org/book/de-secretis/search/text?q=archeus', CLAUDE));
    expect(res?.status).toBe(404);
  });

  it('is a global-only path, and only that exact shape', () => {
    expect(isGlobalOnlyTenantPath('/book/de-secretis/search/text')).toBe(true);
    expect(isGlobalOnlyTenantPath('/book/de-secretis/search')).toBe(false);
    expect(isGlobalOnlyTenantPath('/book/de-secretis')).toBe(false);
    expect(isGlobalOnlyTenantPath('/book/de-secretis/page/p1')).toBe(false);
  });

  it('refuses a partner request in the route too', async () => {
    const res = await call('archeus', { headers: { 'x-tenant-slug': 'bph', 'x-tenant-id': 't1' } });
    expect(res.status).toBe(404);
    expect(state.urls).toHaveLength(0);
  });

  it('is allowed for assistant fetchers and disallowed for everything else in robots.txt', async () => {
    const groups = (await (robots() as Response).text()).split(/\n\n/);
    const group = (ua: string) => groups.find((g) => g.startsWith(`User-agent: ${ua}\n`))!;
    for (const ua of ['Claude-User', 'ChatGPT-User', 'Perplexity-User']) {
      expect(group(ua), ua).toContain('Allow: /book/*/search/text\n');
      // No tie: an Allow and a Disallow on one path is read differently by parsers.
      expect(group(ua), ua).not.toMatch(/^Disallow: \/book\/\*\/search\/text$/m);
      expect(group(ua), ua).not.toMatch(/^Disallow: \/search\/text$/m);
    }
    for (const ua of ['*', 'Claude-SearchBot', 'OAI-SearchBot', 'Sogou web spider']) {
      expect(group(ua), ua).toMatch(/^Disallow: \/book\/\*\/search\/text$/m);
      expect(group(ua), ua).not.toContain('Allow: /book/*/search/text');
    }
    expect(group('GPTBot')).toMatch(/^Disallow: \/$/m);
    expect(group('GPTBot')).not.toContain('/search/text');
    // The book's whole text stays out for everyone.
    expect(group('Claude-User')).not.toContain('Allow: /api/books/*/text');
  });
});

describe('/book/<slug>/search/text', () => {
  it('puts passages, page links and quote URLs in the HTML', async () => {
    const res = await call('archeus');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('href="https://sourcelibrary.org/book/de-secretis/page/p99"');
    expect(html).toContain('On Secrets, page 99');
    expect(html).toContain('the Archeus works in the stomach');
    expect(html).toContain('https://sourcelibrary.org/api/books/b1/quote?page=99');
    expect(html).toContain('href="https://sourcelibrary.org/book/de-secretis"');
    expect(html).toContain('[front matter]');
  });

  it('says what kind of words each snippet is', async () => {
    const html = await (await call('archeus')).text();
    expect(html).toMatch(/stomach\.\.\. <small>\[machine translation\]<\/small>/);
    expect(html).toMatch(/stomacho\.\.\. <small>\[transcription of the original\]<\/small>/);
  });

  it('searches by the book id when it is addressed by slug, since pages carry the id', async () => {
    await call('archeus', { book: 'de-secretis' });
    expect(state.ids).toEqual(['b1']);
    expect(state.urls[0]).toContain('/api/books/b1/search?q=archeus');
  });

  it('goes through the same gate as /api/search', () => {
    expect(state.gated).toContain('book_search_text');
  });

  it('is not indexed or cached', async () => {
    const res = await call('archeus');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('escapes the query and stored fields', async () => {
    state.book = { id: 'b1', slug: 'de-secretis', title: '<img src=x onerror=alert(1)>' };
    state.results = [{ pageId: 'p1', pageNumber: 1, matches: [{ field: 'ocr', snippet: '<script>alert(2)</script>' }] }];
    const html = await (await call('<script>alert(1)</script>')).text();
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
  });

  it('passes no paging through and shows at most 20 passages', async () => {
    state.results = Array.from({ length: 50 }, (_, i) => ({ pageId: `p${i}`, pageNumber: i + 1, matches: [{ field: 'ocr', snippet: `s${i}` }] }));
    state.total = 180;
    const html = await (await call('archeus', { extra: '&offset=9000&limit=500' })).text();
    expect(state.urls).toHaveLength(1);
    expect(state.urls[0]).not.toContain('offset');
    expect(state.urls[0]).not.toContain('limit');
    expect(html.match(/<li>/g)).toHaveLength(20);
    expect(html).toContain('The top 20 of 180 matching pages.');
  });

  it('refuses a declared training crawler before searching', async () => {
    const res = await call('archeus', { ua: 'Mozilla/5.0 (compatible; GPTBot/1.1; +https://openai.com/gptbot)' });
    expect(res.status).toBe(403);
    expect(state.urls).toHaveLength(0);
    expect(await res.text()).toContain('/licensing');
  });

  it('passes a limit through as a limit, not as no results', async () => {
    state.status = 429;
    const res = await call('archeus');
    expect(res.status).toBe(429);
    expect(await res.text()).toContain('limit');
  });

  it('answers a hidden or unknown book with a 404', async () => {
    state.status = 404;
    expect((await call('archeus')).status).toBe(404);
    state.book = null;
    state.urls = [];
    expect((await call('archeus', { book: 'nope' })).status).toBe(404);
    expect(state.urls).toHaveLength(0);
  });

  it('says empty means try other words', async () => {
    state.results = [];
    state.total = 0;
    expect(await (await call('zzzz')).text()).toContain('try other words');
  });

  it('explains itself when given no query', async () => {
    const res = await call(null);
    expect(res.status).toBe(400);
    expect(state.urls).toHaveLength(0);
    expect(await res.text()).toContain('https://sourcelibrary.org/book/de-secretis/search/text?q=YOUR+WORDS');
  });
});

describe('a forged assistant name (#4357)', () => {
  it('Claude-User from an address that is not Anthropic\'s is refused like any unproven bot', async () => {
    const res = await call('archeus', { headers: { 'x-forwarded-for': '203.0.113.7' } });
    expect(res.status).toBe(403);
  });
});
