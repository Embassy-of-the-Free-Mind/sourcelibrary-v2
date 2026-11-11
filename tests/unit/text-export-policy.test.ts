import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { ApiIdentity } from '@/lib/api-auth';

/**
 * What /api/books/[id]/text returns, by caller (#8098). The rungs themselves are
 * pinned in partner-text-access.test.ts; these pin the route: nothing from it may
 * enter a shared cache, hidden rows stay with the pipeline and editors, and a
 * chapter is no way past a clamp.
 */

type Doc = Record<string, unknown>;
const PARTNER = 'tenant-partner';
const CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

const pages: Doc[] = [
  { book_id: 'b', page_number: -3, ocr: { data: 'hidden row' } },
  { book_id: 'b', page_number: 2, page_type: 'digitizer-insert', ocr: { data: 'insert row' } },
  ...Array.from({ length: 100 }, (_, i) => ({ book_id: 'b', page_number: i + 1 === 2 ? 102 : i + 1, ocr: { data: `page ${i + 1}` } })),
];
const books: Doc[] = [
  { id: 'b', title: 'Partner book', tenantId: PARTNER, pages_count: 100, chapters: [{ title: 'All', pageStart: 1, pageEnd: 100 }] },
  { id: 'g', title: 'Library book', pages_count: 100 },
];

function inRange(n: number, cond: { $gte?: number; $lte?: number } | undefined) {
  return !cond || ((cond.$gte === undefined || n >= cond.$gte) && (cond.$lte === undefined || n <= cond.$lte));
}
const fakeDb = {
  collection: (name: string) => ({
    findOne: async (f: Doc) => {
      if (name === 'tenants') return { id: PARTNER, slug: f.slug };
      if (name === 'books') return books.find((b) => b.id === f.id) ?? null;
      return null;
    },
    find: (f: Doc) => {
      const rows = name === 'pages'
        ? pages.filter((p) => ['b', 'g'].includes(String(f.book_id)) && inRange(p.page_number as number, f.page_number as never))
        : [];
      const c = {
        project: () => c, sort: () => c,
        toArray: async () => [...rows].sort((x, y) => (x.page_number as number) - (y.page_number as number)),
      };
      return c;
    },
  }),
};

vi.mock('@/lib/mongodb', () => ({ getDb: async () => fakeDb, getReadDb: async () => fakeDb, default: Promise.resolve({ db: () => fakeDb }) }));
vi.mock('@/lib/auth', () => ({ auth: async () => null }));
vi.mock('@/lib/auth-helpers', () => ({ isInnerCircle: async () => innerCircle, withAuth: (h: unknown) => h, withAdminAuth: (h: unknown) => h }));
vi.mock('@/lib/api-budget', () => ({
  checkPageBudget: async () => ({ allowed: true, limit: -1, used: 0, remaining: 0, tier: 'anon' }),
  bulkBudgetExceededBody: () => ({}),
}));
vi.mock('@/lib/bot-reads', () => ({ logBotRead: () => {} }));
vi.mock('@/lib/suspected-pool', () => ({ poolRefFor: async () => undefined }));

let innerCircle = false;
beforeEach(() => {
  innerCircle = false;
  vi.unstubAllEnvs();
});

async function call(id: string, query: string, headers: Record<string, string>, identity: ApiIdentity = { kind: 'anon' }) {
  const { GET } = await import('@/app/api/books/[id]/text/route');
  const res = await GET.handler(
    new NextRequest(`https://sourcelibrary.org/api/books/${id}/text?${query}`, { headers }),
    { params: Promise.resolve({ id }) },
    identity,
  );
  return { res, body: await res.json() as { pages?: Array<{ page_number: number; ocr: string }>; reading_window?: { next_from: number }; bot_access?: unknown } };
}
const numbers = (b: { pages?: Array<{ page_number: number }> }) => (b.pages ?? []).map((p) => p.page_number);
const browser = { 'user-agent': CHROME, 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-origin' };
/** An assistant reading for a person, proven by name and published address (api-auth sets this). */
const ASSISTANT: ApiIdentity = { kind: 'anon', assistantFetcher: 'anthropic' };

describe('/text: nothing enters a shared cache', () => {
  it.each([
    ['a browser on a library book', 'g', '', browser],
    ['a browser on a partner book', 'b', '', browser],
    ['a script on a partner book', 'b', '', { 'user-agent': 'python-requests/2.32' }],
    ['a declared crawler', 'g', '', { 'user-agent': 'GPTBot/1.2' }],
  ])('%s', async (_n, id, q, h) => {
    const { res } = await call(id, q, h as Record<string, string>);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });
});

describe('/text: hidden rows', () => {
  it('leaves them out for a browser, an ordinary reader and a script', async () => {
    const a = await call('g', '', browser);
    expect(numbers(a.body)).not.toContain(-3);
    expect(JSON.stringify(a.body)).not.toContain('insert row');
    const b = await call('g', '', browser, { kind: 'session', userId: 'u' });
    expect(numbers(b.body)).not.toContain(-3);
    const c = await call('g', 'from=-5', { 'user-agent': 'curl/8' });
    expect(numbers(c.body)).not.toContain(-3);
  });

  it('keeps them for an editor and for the pipeline', async () => {
    innerCircle = true;
    expect(numbers((await call('g', '', browser, { kind: 'session', userId: 'u' })).body)).toContain(-3);
    innerCircle = false;
    vi.stubEnv('CRON_SECRET', 's');
    expect(numbers((await call('g', '', { 'user-agent': 'node', authorization: 'Bearer s' })).body)).toContain(-3);
  });
});

describe('/text: a protected partner book', () => {
  it('is whole for a browser', async () => {
    expect(numbers((await call('b', '', browser)).body).length).toBe(100);
  });

  it('is the first 20% for a crawler that names itself, wherever it asks to start', async () => {
    // A key-less script is refused before the book is read (see below); a declared
    // crawler with a verified identity is not anon, so it still meets the 20% clamp.
    const crawler = { 'user-agent': 'GPTBot/1.2' };
    const whole = await call('b', '', crawler, { kind: 'bot', bot: 'gptbot' });
    expect(Math.max(...numbers(whole.body))).toBe(20);
    expect(whole.body.bot_access).toBeTruthy();
    expect(numbers((await call('b', 'from=50&to=90', crawler, { kind: 'bot', bot: 'gptbot' })).body)).toEqual([]);
  });

  it('gets no whole book by asking for its one chapter', async () => {
    const { body } = await call('b', 'chapter=0', { 'user-agent': 'GPTBot/1.2' }, { kind: 'bot', bot: 'gptbot' });
    expect(Math.max(...numbers(body))).toBe(20);
  });

  it('comes a window at a time to a proven assistant reading for a person, which is told where to go next', async () => {
    const { body } = await call('b', 'from=30', { 'user-agent': 'Claude-User/1.0' }, ASSISTANT);
    expect(Math.min(...numbers(body))).toBe(30);
    expect(Math.max(...numbers(body))).toBe(54);
    expect(body.reading_window?.next_from).toBe(55);
    expect((await call('b', 'from=90', { 'user-agent': 'Claude-User/1.0' }, ASSISTANT)).body.reading_window).toBeUndefined();
  });

  it('is whole for a key, and the switch puts every caller back on the site rules', async () => {
    const script = { 'user-agent': 'python-requests/2.32' };
    expect(numbers((await call('b', '', script, { kind: 'apikey', apiKeyId: 'k' })).body).length).toBe(100);
    vi.stubEnv('BPH_BOT_GATE_ENFORCE', '0');
    expect(numbers((await call('b', '', { 'user-agent': 'Claude-User/1.0' }, ASSISTANT)).body).length).toBe(100);
  });

  it('leaves a library book whole for a key and for a proven assistant', async () => {
    expect(numbers((await call('g', '', { 'user-agent': 'curl/8' }, { kind: 'apikey', apiKeyId: 'k' })).body).length).toBe(100);
    expect(numbers((await call('g', '', { 'user-agent': 'Claude-User/1.0' }, ASSISTANT)).body).length).toBe(100);
  });
});

describe('/text: whole-book text needs a key or a session (#8235)', () => {
  it('refuses a key-less script, and says how to get a key', async () => {
    const { res, body } = await call('g', '', { 'user-agent': 'python-requests/2.32' });
    expect(res.status).toBe(401);
    expect((body as { error?: string }).error).toBe('key_required');
    expect(res.headers.get('www-authenticate')).toContain('get_key=');
  });

  it('refuses a client that only CLAIMS to be an assistant', async () => {
    expect((await call('g', '', { 'user-agent': 'Claude-User/1.0' })).res.status).toBe(401);
  });

  it('serves the site’s own browser pages and a signed-in reader', async () => {
    expect((await call('g', '', browser)).res.status).toBe(200);
    expect((await call('g', '', { 'user-agent': CHROME }, { kind: 'session', userId: 'u' })).res.status).toBe(200);
  });
});
