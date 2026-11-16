import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * A book named by the slug from its URL is the same book as one named by id.
 *
 * Every link the connector and the site hand out is /book/<slug>, so an
 * assistant holding only the link passes the slug where a tool asks for
 * `book_id`. In the 30 days to 2026-11-12 the connector answered "Book not
 * found" for 76 distinct ids, and 25 of them were visible, readable books
 * (v2#8154). These fail if a slug stops resolving on the text route or the
 * in-book search, if a hidden book becomes readable by its slug, or if a call
 * by id starts paying for a slug lookup.
 */

type Doc = Record<string, unknown>;
const ID = '69c79da6732b9d1f2b38170b';
const HIDDEN_ID = '69c79da6732b9d1f2b38170c';
const SLUG = 'de-perenni-philosophia-steuco';

const books: Doc[] = [
  { id: ID, slug: SLUG, slug_aliases: ['perennial-philosophy-steuco'], title: 'De perenni philosophia', visible: true, pages_count: 3, pages_translated: 3 },
  { id: HIDDEN_ID, slug: 'a-hidden-book', title: 'Hidden', visible: false, pages_count: 3 },
];
const pages: Doc[] = [1, 2, 3].flatMap((n) => [
  { id: `p${n}`, book_id: ID, page_number: n, ocr: { data: `textus ${n}` }, translation: { data: `mercury text ${n}` } },
  { id: `h${n}`, book_id: HIDDEN_ID, page_number: n, ocr: { data: `occultus ${n}` }, translation: { data: `hidden mercury ${n}` } },
]);

const seen = vi.hoisted(() => ({
  bookQueries: [] as Array<Record<string, unknown>>,
  atlasBookIds: [] as string[],
  semanticBookIds: [] as string[][],
  logged: [] as Array<Record<string, unknown>>,
}));

/** Enough of Mongo's matching for the lookups these routes make. */
function matches(b: Doc, f: Doc): boolean {
  if (Array.isArray(f.$or)) return (f.$or as Doc[]).some((c) => matches(b, c));
  return Object.entries(f).every(([k, v]) => {
    if (k === '_id') return false; // no book here is findable by _id
    if (k === 'slug_aliases') return Array.isArray(b.slug_aliases) && (b.slug_aliases as unknown[]).includes(v);
    return b[k] === v;
  });
}
const fakeDb = {
  collection: (name: string) => ({
    findOne: async (f: Doc) => {
      if (name === 'books') {
        seen.bookQueries.push(f);
        return books.find((b) => matches(b, f)) ?? null;
      }
      return null;
    },
    find: (f: Doc) => {
      const rows = name === 'pages' ? pages.filter((p) => p.book_id === f.book_id) : [];
      const c = { project: () => c, sort: () => c, limit: () => c, toArray: async () => rows };
      return c;
    },
    aggregate: (stages: Doc[]) => {
      const bookId = String((stages[0] as { $bookId?: string }).$bookId);
      seen.atlasBookIds.push(bookId);
      const rows = pages.filter((p) => p.book_id === bookId).map((p) => ({
        ...p, searchScore: 3,
        highlights: [{ path: 'translation.data', texts: [{ type: 'hit', value: 'mercury' }] }],
      }));
      return { toArray: async () => rows };
    },
  }),
};

vi.mock('@/lib/mongodb', () => ({ getDb: async () => fakeDb, getReadDb: async () => fakeDb, default: Promise.resolve({ db: () => fakeDb }) }));
vi.mock('@/lib/auth', () => ({ auth: async () => null }));
vi.mock('@/lib/auth-helpers', () => ({ isInnerCircle: async () => false, withAuth: (h: unknown) => h, withAdminAuth: (h: unknown) => h }));
vi.mock('@/lib/api-budget', () => ({
  checkPageBudget: async () => ({ allowed: true, limit: -1, used: 0, remaining: 0, tier: 'anon' }),
  bulkBudgetExceededBody: () => ({}),
}));
vi.mock('@/lib/bot-reads', () => ({ logBotRead: () => {} }));
vi.mock('@/lib/suspected-pool', () => ({ poolRefFor: async () => undefined }));
// The in-book search's legs, reduced to "which book were you asked about".
vi.mock('@/lib/atlas-search', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/atlas-search')>()),
  buildPageSearchStage: (_q: string, bookId: string) => ({ $bookId: bookId }),
}));
vi.mock('@/lib/keyword-search', () => ({ keywordSearchMode: () => 'off', serveKeywordPages: async () => { throw new Error('off'); } }));
vi.mock('@/lib/semantic-search', () => ({
  semanticPageSearchScoped: async (_q: string, ids: string[]) => { seen.semanticBookIds.push(ids); return []; },
  lexicalPageSearchLang: async () => [],
}));
vi.mock('@/lib/semantic-coverage', () => ({ semanticCoverage: async () => ({ status: 'full' }) }));
vi.mock('@/lib/search/name-variants', () => ({ expandPersonNames: async () => [] }));
vi.mock('@/lib/search-event-log', () => ({ logSearchEvent: (e: Record<string, unknown>) => seen.logged.push(e) }));

const CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const browser = { 'user-agent': CHROME, 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-origin' };

// The two routes pull in most of the app; load them once, outside any one test's clock.
beforeAll(async () => {
  await import('@/app/api/books/[id]/text/route');
  await import('@/app/api/books/[id]/search/route');
}, 180_000);

beforeEach(() => {
  Object.assign(seen, { bookQueries: [], atlasBookIds: [], semanticBookIds: [], logged: [] });
  vi.unstubAllEnvs();
});

describe('resolveBookRef: a name for a book becomes its id', () => {
  const resolve = async (ref: string) => (await import('@/lib/book-lookup')).resolveBookRef(fakeDb as never, ref);

  it('an id comes back as it came, with no query', async () => {
    expect(await resolve(ID)).toBe(ID);
    expect(await resolve('dbdc472a-b39f-4005-abb4-654428f7bf61')).toBe('dbdc472a-b39f-4005-abb4-654428f7bf61');
    expect(seen.bookQueries).toEqual([]);
  });

  it('a slug becomes the id, in one lookup', async () => {
    expect(await resolve(SLUG)).toBe(ID);
    expect(seen.bookQueries).toEqual([{ slug: SLUG }]);
  });

  it('a slug the book used to have still resolves', async () => {
    expect(await resolve('perennial-philosophy-steuco')).toBe(ID);
  });

  it('a string that names no book comes back unchanged, so the caller answers not-found as before', async () => {
    expect(await resolve('no-such-book')).toBe('no-such-book');
    expect(await resolve('')).toBe('');
  });
});

describe('/api/books/[id]/text by slug', () => {
  async function text(ref: string) {
    const { GET } = await import('@/app/api/books/[id]/text/route');
    const res = await GET.handler(
      new NextRequest(`https://sourcelibrary.org/api/books/${ref}/text`, { headers: browser }),
      { params: Promise.resolve({ id: ref }) },
      { kind: 'session', userId: 'u' },
    );
    return { status: res.status, body: await res.json() as { error?: string; pages?: Array<{ page_number: number }> } };
  }

  it('the slug and the id return the same book', async () => {
    const byId = await text(ID);
    const bySlug = await text(SLUG);
    expect(byId.status).toBe(200);
    expect(bySlug.status).toBe(200);
    expect(bySlug.body).toEqual(byId.body);
    expect((bySlug.body.pages ?? []).map((p) => p.page_number)).toEqual([1, 2, 3]);
  });

  it('a call by id pays for no slug lookup', async () => {
    await text(ID);
    expect(seen.bookQueries.length).toBeGreaterThan(0);
    expect(seen.bookQueries.every((q) => Object.keys(q).join() === 'id' && q.id === ID)).toBe(true);
  });

  it('a hidden book is still not found by its slug', async () => {
    const r = await text('a-hidden-book');
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('Book not found');
    expect(r.body.pages).toBeUndefined();
  });

  it('a slug that names no book is not found', async () => {
    expect((await text('no-such-book')).status).toBe(404);
  });
});

describe('/api/books/[id]/search by slug', () => {
  async function search(ref: string) {
    const { GET } = await import('@/app/api/books/[id]/search/route');
    const res = await GET(
      new NextRequest(`https://sourcelibrary.org/api/books/${ref}/search?q=mercury`, { headers: browser }),
      { params: Promise.resolve({ id: ref }) },
    );
    return { status: res.status, body: await res.json() as { error?: string; results?: Array<{ pageNumber: number }> } };
  }

  it('every leg searches the book the slug names, by its id', async () => {
    const bySlug = await search(SLUG);
    expect(bySlug.status).toBe(200);
    expect(seen.atlasBookIds).toEqual([ID]);
    expect(seen.semanticBookIds).toEqual([[ID]]);
    expect((seen.logged[0].filters as Record<string, unknown>).book_id).toBe(ID);
    expect((bySlug.body.results ?? []).map((r) => r.pageNumber).sort()).toEqual([1, 2, 3]);
  });

  it('the slug and the id return the same pages', async () => {
    const byId = await search(ID);
    const bySlug = await search(SLUG);
    expect(bySlug.body.results).toEqual(byId.body.results);
  });

  it('a hidden book is still not found by its slug, and no leg runs', async () => {
    const r = await search('a-hidden-book');
    expect(r.status).toBe(404);
    expect(seen.atlasBookIds).toEqual([]);
    expect(seen.semanticBookIds).toEqual([]);
  });
});
