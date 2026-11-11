import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/**
 * /search/text gives an assistant results it can read without JavaScript (#8161).
 * The risks: an injection through the query or a stored title, training crawlers
 * reading it, and turning it into a way to page through the catalogue.
 */
const state = vi.hoisted(() => ({
  urls: [] as string[],
  status: 200,
  books: [] as Record<string, unknown>[],
  pages: [] as Record<string, unknown>[],
  pictures: [] as Record<string, unknown>[],
  galleryUrls: [] as string[],
  galleryStatus: 200,
}));

vi.mock('@/app/api/search/route', () => ({
  GET: async (req: Request) => {
    state.urls.push(req.url);
    if (state.status !== 200) return NextResponse.json({ error: 'limit' }, { status: state.status });
    const results = req.url.includes('pages_only=true') ? state.pages : state.books;
    return NextResponse.json({ results });
  },
}));
vi.mock('@/app/api/gallery/route', () => ({
  GET: async (req: Request) => {
    state.galleryUrls.push(req.url);
    if (state.galleryStatus !== 200) return NextResponse.json({ error: 'limit' }, { status: state.galleryStatus });
    return NextResponse.json({ items: state.pictures, total: state.pictures.length });
  },
}));
vi.mock('@/lib/api-auth', () => ({ withApiAuth: (handler: unknown) => handler }));
vi.mock('@/lib/dataset/api-keys', () => ({ validateApiKey: async () => null }));
vi.mock('@/lib/crawler-verify', () => ({ provableClaimIn: () => null, verifyCrawlerClaim: async () => 'unknown' }));

import { GET } from '@/app/search/text/route';
import { GET as robots } from '@/app/robots.txt/route';
import { proxy } from '@/proxy';

const CLAUDE = 'Mozilla/5.0 (compatible; Claude-User/1.0; +Claude-User@anthropic.com)';
const ANTHROPIC_IP = '160.79.104.10';
const call = (q: string | null, ua = CLAUDE) => GET(new NextRequest(
  `https://sourcelibrary.org/search/text${q === null ? '' : `?q=${encodeURIComponent(q)}`}`,
  // A real Claude-User arrives from Anthropic's published range (#4357).
  { headers: { 'user-agent': ua, 'x-forwarded-for': ANTHROPIC_IP } },
));

beforeEach(() => {
  state.urls = [];
  state.galleryUrls = [];
  state.galleryStatus = 200;
  state.pictures = [
    { source: 'illustration', pageId: 'p7', bookId: 'b1', pageNumber: 7, detectionIndex: 1, bookTitle: 'De secretis', author: 'Suchten', year: '1570', description: 'A dragon', extractedUrl: 'https://images.sourcelibrary.org/gallery/b1/p7-1.jpg', thumbnailUrl: 'https://images.sourcelibrary.org/gallery/b1/p7-1-card.jpg' },
    { source: 'artwork', pageId: 'artwork-a1', bookId: 'a1', pageNumber: 0, link: '/artwork/dragon', bookTitle: 'Dragon', year: 1863, description: 'Another <b>dragon</b>', imageUrl: 'https://images.sourcelibrary.org/artwork/dragon.jpg' },
  ];
  state.status = 200;
  state.books = [{ type: 'book', book_id: 'b1', slug: 'de-secretis', title: 'De secretis', display_title: 'On Secrets', author: 'Suchten', published: '1570', snippet: 'About antimony', snippet_type: 'summary' }];
  state.pages = [{ type: 'page', book_id: 'b1', slug: 'de-secretis', title: 'De secretis', page_id: 'p99', page_number: 99, snippet: 'Archeus. Before that', snippet_type: 'translation' }];
});

describe('who reaches it', () => {
  const req = (url: string, ua: string) => new NextRequest(url, {
    headers: { host: new URL(url).host, 'user-agent': ua, 'accept-language': 'en', 'sec-fetch-mode': 'navigate' },
  });
  const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
  const rewrite = (res: Response | undefined) => res?.headers.get('x-middleware-rewrite') ?? '';

  it('sends a named assistant fetcher from /search to the readable results', async () => {
    const res = await proxy(req('https://sourcelibrary.org/search?q=ficino', CLAUDE));
    expect(rewrite(res)).toContain('/search/text?q=ficino');
  });

  it('leaves a person on the cached page', async () => {
    expect(rewrite(await proxy(req('https://sourcelibrary.org/search?q=ficino', CHROME)))).not.toContain('/search/text');
  });

  it('leaves an empty /search alone, since there is nothing to search', async () => {
    expect(rewrite(await proxy(req('https://sourcelibrary.org/search', CLAUDE)))).not.toContain('/search/text');
  });

  it('is refused on a partner subdomain, where search stays scoped', async () => {
    const res = await proxy(req('https://bph.sourcelibrary.org/search/text?q=ficino', CLAUDE));
    expect(res?.status).toBe(404);
    const scoped = await proxy(req('https://bph.sourcelibrary.org/search?q=ficino', CLAUDE));
    expect(rewrite(scoped)).not.toContain('/search/text');
  });

  it('is allowed for assistant fetchers and disallowed for everything else in robots.txt', async () => {
    const groups = (await (robots() as Response).text()).split(/\n\n/);
    const group = (ua: string) => groups.find((g) => g.startsWith(`User-agent: ${ua}\n`))!;
    for (const ua of ['Claude-User', 'ChatGPT-User', 'Perplexity-User']) {
      expect(group(ua), ua).toContain('Allow: /search/text\n');
      expect(group(ua), ua).not.toMatch(/^Disallow: \/search\/text$/m);
    }
    for (const ua of ['*', 'Claude-SearchBot', 'OAI-SearchBot', 'Sogou web spider']) {
      expect(group(ua), ua).toMatch(/^Disallow: \/search\/text$/m);
      expect(group(ua), ua).not.toContain('Allow: /search/text');
    }
    expect(group('GPTBot')).toMatch(/^Disallow: \/$/m);
    expect(group('GPTBot')).not.toContain('/search/text');
  });
});

describe('/search/text', () => {
  it('puts books, passages, links and citations in the HTML', async () => {
    const res = await call('archeus');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('https://sourcelibrary.org/book/de-secretis"');
    expect(html).toContain('https://sourcelibrary.org/book/de-secretis/page/p99');
    expect(html).toContain('Archeus. Before that');
    expect(html).toContain('/api/books/b1/quote?page=99');
  });

  it('says what kind of words each snippet is', async () => {
    const html = await (await call('archeus')).text();
    expect(html).toContain('AI description, not the author’s words');
    expect(html).toContain('machine translation');
  });

  it('is not indexed or cached', async () => {
    const res = await call('archeus');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('escapes the query and stored fields', async () => {
    state.books = [{ book_id: 'b1', slug: 's', title: '<img src=x onerror=alert(1)>' }];
    const html = await (await call('<script>alert(1)</script>')).text();
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
  });

  it('asks for a fixed number of results and passes no paging through', async () => {
    await GET(new NextRequest('https://sourcelibrary.org/search/text?q=archeus&limit=500&offset=9000', { headers: { 'user-agent': CLAUDE, 'x-forwarded-for': ANTHROPIC_IP } }));
    expect(state.urls).toHaveLength(2);
    for (const url of state.urls) {
      expect(url).toContain('limit=10');
      expect(url).not.toContain('offset');
      expect(url).not.toContain('limit=500');
    }
  });

  it('refuses a declared training crawler before searching', async () => {
    const res = await call('archeus', 'Mozilla/5.0 (compatible; GPTBot/1.1; +https://openai.com/gptbot)');
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

  it('says empty means try other words', async () => {
    state.books = [];
    state.pages = [];
    expect(await (await call('zzzz')).text()).toContain('try other words');
  });

  it('explains itself when given no query', async () => {
    const res = await call(null);
    expect(res.status).toBe(400);
    expect(state.urls).toHaveLength(0);
    expect(await res.text()).toContain('/search/text?q=YOUR+WORDS');
  });
});

describe('pictures', () => {
  const pictures = (q: string, ua = CLAUDE) => GET(new NextRequest(
    `https://sourcelibrary.org/search/text?q=${encodeURIComponent(q)}&pictures=1`,
    // A real Claude-User arrives from Anthropic's published range (#4357).
  { headers: { 'user-agent': ua, 'x-forwarded-for': ANTHROPIC_IP } },
  ));
  const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
  const fromProxy = async (url: string, ua: string) => (await proxy(new NextRequest(url, {
    headers: { host: 'sourcelibrary.org', 'user-agent': ua, 'accept-language': 'en', 'sec-fetch-mode': 'navigate' },
  })))?.headers.get('x-middleware-rewrite') ?? '';

  it('gives each kind of picture the right link and says the description is AI', async () => {
    const html = await (await pictures('dragon')).text();
    expect(html).toContain('https://sourcelibrary.org/gallery/image/p7-1');
    expect(html).toContain('https://sourcelibrary.org/artwork/dragon');
    expect(html).not.toContain('gallery/image/artwork-');
    expect(html).toContain('illustration on page 7');
    expect(html).toContain('[AI description]');
    expect(html).toContain('https://images.sourcelibrary.org/gallery/b1/p7-1.jpg');
  });

  it('escapes stored text and the query', async () => {
    const html = await (await pictures('<script>x</script>')).text();
    expect(html).not.toContain('<script>x');
    expect(html).not.toContain('<b>dragon</b>');
  });

  it('asks for a short list, spread across books, and runs no text search', async () => {
    await pictures('dragon');
    expect(state.galleryUrls[0]).toContain('limit=12');
    expect(state.galleryUrls[0]).toContain('maxPerBook=2');
    expect(state.urls).toEqual([]);
  });

  it('a search for words links to pictures and does not fetch them', async () => {
    const html = await (await call('dragon')).text();
    expect(html).toContain('pictures=1');
    expect(state.galleryUrls).toEqual([]);
  });

  it('says so when the limit is reached', async () => {
    state.galleryStatus = 429;
    expect((await pictures('dragon')).status).toBe(429);
  });

  it('sends a fetcher from /gallery?q= here, and leaves a person and a bare /gallery alone', async () => {
    expect(await fromProxy('https://sourcelibrary.org/gallery?q=dragon', CLAUDE)).toContain('/search/text?q=dragon&pictures=1');
    expect(await fromProxy('https://sourcelibrary.org/gallery?q=dragon', CHROME)).not.toContain('/search/text');
    expect(await fromProxy('https://sourcelibrary.org/gallery', CLAUDE)).not.toContain('/search/text');
  });
});
