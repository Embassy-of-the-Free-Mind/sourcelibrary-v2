import { describe, it, expect, vi, beforeEach } from 'vitest';

// Tenant scope for the vector lanes (#4330, #2753).
//
// The defect: /api/search/semantic had no notion of a tenant, so
// bhutan.sourcelibrary.org/api/search/semantic?q=alchemy returned the global
// library. The lanes that did filter did it AFTER ranking the whole corpus.
//
// What is pinned here is where the scope is applied, not just that results
// come out clean: a closed scope must not reach the query layer at all (the
// rpc stub throws), and a tenant scope must call the book-set RPC rather than
// rank globally. Each "foreign rows are dropped" assertion has a positive
// control — the same rows DO come through under the global scope — so a filter
// that reads a field the fixture lacks cannot pass vacuously
// (tests-that-are-not-guards.md).

const TENANT = 'tenant-bhutan';
const OWN = ['own-1', 'own-2'];
const FOREIGN = ['foreign-1', 'foreign-2'];

type Book = { id: string; tenantId?: string; visible?: boolean; hidden?: boolean; slug?: string };
const state = {
  books: [] as Book[],
  tenants: [{ slug: 'bhutan', id: TENANT, status: 'active' }] as Array<{ slug: string; id: string; status: string }>,
  mongoDown: false,
  bookQueries: [] as Array<Record<string, unknown>>,
};

const matches = (b: Book, q: Record<string, any>) => {
  if (q.tenantId !== undefined && b.tenantId !== q.tenantId) return false;
  if (q.visible !== undefined && (b.visible ?? true) !== q.visible) return false;
  if (q.hidden?.$ne !== undefined && b.hidden === q.hidden.$ne) return false;
  if (q.id?.$in && !q.id.$in.includes(b.id)) return false;
  return true;
};
const fakeDb = {
  collection: (name: string) => ({
    findOne: async (q: { slug: string }) => {
      if (state.mongoDown) throw new Error('mongo down');
      return name === 'tenants' ? state.tenants.find(t => t.slug === q.slug) ?? null : null;
    },
    find: (q: Record<string, any>) => {
      if (name === 'books') state.bookQueries.push(q);
      return {
        project: () => ({ toArray: async () => state.books.filter(b => matches(b, q)) }),
        toArray: async () => {
          if (state.mongoDown) throw new Error('mongo down');
          return name === 'books' ? state.books.filter(b => matches(b, q)) : [];
        },
      };
    },
  }),
};

const rpc = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock('@/lib/mongodb', () => ({ getDb: async () => fakeDb, getReadDb: async () => fakeDb }));
vi.mock('@/lib/search-log', () => ({ logSearchQuery: () => {} }));
vi.mock('@/lib/books-catalog', () => ({
  searchBooksCatalog: async () => [...FOREIGN, ...OWN].map(id => ({ id, title: id, author: null, year: 1600, language: 'Latin' })),
}));
vi.mock('@/lib/search/work-fanout', () => ({ fetchWorkFanouts: async () => new Map() }));

const headers = (h: Record<string, string> = {}) => new Headers(h);
const bookRow = (book_id: string, similarity = 0.9) => ({ book_id, title: book_id, similarity });
const allRows = () => [...FOREIGN, ...OWN].map(id => bookRow(id));

beforeEach(async () => {
  rpc.mockReset();
  vi.resetModules();
  state.mongoDown = false;
  state.bookQueries = [];
  state.books = [
    ...OWN.map(id => ({ id, tenantId: TENANT, visible: true, slug: id })),
    { id: 'own-hidden', tenantId: TENANT, visible: false },
    ...FOREIGN.map(id => ({ id, visible: true, slug: id })),
  ];
  process.env.GEMINI_API_KEY = 'test-key';
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ embeddings: [{ values: Array(768).fill(0.01) }] }),
  }) as unknown as typeof fetch;
});

describe('resolveSearchScope', () => {
  it('is global only when the request carries no tenant signal at all', async () => {
    const { resolveSearchScope } = await import('@/lib/tenant-search-scope');
    expect((await resolveSearchScope(headers())).kind).toBe('global');
  });

  it("is the tenant's visible books, read from books.tenantId", async () => {
    const { resolveSearchScope } = await import('@/lib/tenant-search-scope');
    const scope = await resolveSearchScope(headers({ 'x-tenant-id': TENANT, 'x-tenant-slug': 'bhutan' }));
    expect(scope.kind).toBe('tenant');
    if (scope.kind !== 'tenant') return;
    expect([...scope.bookIds].sort()).toEqual(OWN);
    expect(scope.has('foreign-1')).toBe(false);
    expect(scope.has('own-hidden')).toBe(false);
    expect(state.bookQueries[0]).toMatchObject({ tenantId: TENANT, visible: true });
  });

  it('resolves a slug that arrives without an id', async () => {
    const { resolveSearchScope } = await import('@/lib/tenant-search-scope');
    const scope = await resolveSearchScope(headers({ 'x-tenant-slug': 'bhutan' }));
    expect(scope.kind).toBe('tenant');
  });

  it('is CLOSED, never global, for a tenant signal that cannot be resolved', async () => {
    const { resolveSearchScope } = await import('@/lib/tenant-search-scope');
    expect((await resolveSearchScope(headers({ 'x-tenant-slug': 'no-such-tenant' }))).kind).toBe('closed');
    expect((await resolveSearchScope(headers({ 'x-tenant-embedded': '1' }))).kind).toBe('closed');
  });

  it('is CLOSED when Mongo cannot produce the book set, and does not cache the failure', async () => {
    const { resolveSearchScope } = await import('@/lib/tenant-search-scope');
    state.mongoDown = true;
    expect((await resolveSearchScope(headers({ 'x-tenant-id': TENANT }))).kind).toBe('closed');
    state.mongoDown = false;
    expect((await resolveSearchScope(headers({ 'x-tenant-id': TENANT }))).kind).toBe('tenant');
  });
});

describe('scopedMatch', () => {
  const spec = {
    global: { fn: 'match_books_semantic', args: { match_count: 5 } },
    scoped: { fn: 'match_books_semantic_in_books', args: { match_count: 5 } },
  };

  it('a closed scope never reaches the query layer', async () => {
    const { scopedMatch, closedScope } = await import('@/lib/tenant-search-scope');
    rpc.mockImplementation(() => { throw new Error('the query layer must not be called'); });
    await expect(scopedMatch(closedScope('test'), spec)).resolves.toMatchObject({ rows: [], error: null });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('a tenant with no books never reaches the query layer', async () => {
    const { scopedMatch, bookSetScope } = await import('@/lib/tenant-search-scope');
    await expect(scopedMatch(bookSetScope(TENANT, []), spec)).resolves.toMatchObject({ rows: [] });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('ranks INSIDE the book set: calls the scoped RPC with the ids, never the global one', async () => {
    const { scopedMatch, bookSetScope } = await import('@/lib/tenant-search-scope');
    rpc.mockResolvedValue({ data: OWN.map(id => bookRow(id)), error: null });
    const out = await scopedMatch(bookSetScope(TENANT, OWN), spec);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('match_books_semantic_in_books', { match_count: 5, book_ids: OWN });
    expect(out.rows.map(r => r.book_id)).toEqual(OWN);
  });

  it('drops a foreign row even when the scoped RPC returns one', async () => {
    const { scopedMatch, bookSetScope, GLOBAL_SCOPE } = await import('@/lib/tenant-search-scope');
    rpc.mockResolvedValue({ data: allRows(), error: null });
    const scoped = await scopedMatch(bookSetScope(TENANT, OWN), spec);
    expect(scoped.rows.map(r => r.book_id)).toEqual(OWN);
    // Positive control: the same rows pass under the global scope.
    const global = await scopedMatch(GLOBAL_SCOPE, spec);
    expect(global.rows.map(r => r.book_id)).toEqual([...FOREIGN, ...OWN]);
  });

  for (const error of [
    { code: 'PGRST202', message: 'Could not find the function public.match_books_semantic_in_books' },
    { code: '57014', message: 'canceling statement due to statement timeout' },
  ]) {
    it(`falls back to the global RPC cut to the book set on ${error.code} — closed, not open`, async () => {
      const { scopedMatch, bookSetScope } = await import('@/lib/tenant-search-scope');
      rpc.mockImplementation(async (fn: string) =>
        fn === 'match_books_semantic_in_books' ? { data: null, error } : { data: allRows(), error: null });
      const out = await scopedMatch(bookSetScope(TENANT, OWN), spec);
      expect(out.error).toBeNull();
      expect(out.rows.map(r => r.book_id)).toEqual(OWN);
      // Over-fetched, because the filter runs after the ranking.
      expect(rpc).toHaveBeenLastCalledWith('match_books_semantic', { match_count: 50 });
    });
  }

  it('reports any other error and does NOT consult the global RPC', async () => {
    const { scopedMatch, bookSetScope } = await import('@/lib/tenant-search-scope');
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } });
    const out = await scopedMatch(bookSetScope(TENANT, OWN), spec);
    expect(out).toMatchObject({ rows: [], error: 'permission denied', rpc: 'match_books_semantic_in_books' });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe('semantic-search under a scope', () => {
  it('page search under a tenant uses match_pages_in_scope, not the global ranking', async () => {
    const { semanticPageSearchGlobal } = await import('@/lib/semantic-search');
    const { bookSetScope } = await import('@/lib/tenant-search-scope');
    rpc.mockResolvedValue({ data: [{ page_id: 'p1', book_id: 'own-1', page_number: 3, translation: 'text', similarity: 0.8 }], error: null });
    const out = await semanticPageSearchGlobal('q', 5, { scope: bookSetScope(TENANT, OWN) });
    expect(rpc.mock.calls.map(c => c[0])).toEqual(['match_pages_in_scope']);
    expect(rpc.mock.calls[0][1].book_ids).toEqual(OWN);
    expect(out.map(p => p.book_id)).toEqual(['own-1']);
  });

  it('a closed scope returns nothing from every lane without embedding or querying', async () => {
    const { semanticBookSearch, semanticArtworkSearch, semanticPageSearchGlobal } = await import('@/lib/semantic-search');
    const { closedScope } = await import('@/lib/tenant-search-scope');
    rpc.mockImplementation(() => { throw new Error('the query layer must not be called'); });
    const scope = closedScope('test');
    await expect(semanticBookSearch('q', 5, { scope })).resolves.toEqual([]);
    await expect(semanticArtworkSearch('q', 5, { scope })).resolves.toEqual([]);
    await expect(semanticPageSearchGlobal('q', 5, { scope })).resolves.toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('GET /api/search/semantic on a tenant host', () => {
  const call = async (url: string, h: Record<string, string>) => {
    const { GET } = await import('@/app/api/search/semantic/route');
    const { NextRequest } = await import('next/server');
    const res = await GET(new NextRequest(url, { headers: h }));
    return { body: await res.json(), cache: res.headers.get('Cache-Control') };
  };
  // The scoped functions are "not deployed" here, so the route is exercised on
  // its fallback path — the one production runs until the migration is applied.
  const undeployed = async (fn: string) =>
    fn.endsWith('_in_books') || fn === 'match_pages_in_scope'
      ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
      : { data: allRows().map(r => ({ ...r, page_id: `p-${r.book_id}`, page_number: 1, translation: 't' })), error: null };

  it('returns only the tenant\'s books — the #4330 repro', async () => {
    rpc.mockImplementation(undeployed);
    const tenant = await call('http://bhutan.sourcelibrary.org/api/search/semantic?q=alchemy', { 'x-tenant-id': TENANT, 'x-tenant-slug': 'bhutan' });
    expect(tenant.body.results.map((r: any) => r.book_id).sort()).toEqual(OWN);
    expect(tenant.cache).toBe('private, no-store');
    // Positive control: the apex gets the foreign books from the same stub.
    const apex = await call('http://sourcelibrary.org/api/search/semantic?q=alchemy', {});
    expect(apex.body.results.map((r: any) => r.book_id)).toEqual(expect.arrayContaining(FOREIGN));
    expect(apex.cache).toContain('s-maxage');
  });

  it('page level is scoped too', async () => {
    rpc.mockImplementation(undeployed);
    const tenant = await call('http://bhutan.sourcelibrary.org/api/search/semantic?q=alchemy&level=page', { 'x-tenant-id': TENANT });
    expect(tenant.body.results.map((r: any) => r.book_id).sort()).toEqual(OWN);
  });

  it('the lexical fallback is cut to the scope as well', async () => {
    // Vector lane empty → the route falls back to books_catalog, which has no tenant column.
    rpc.mockResolvedValue({ data: [], error: null });
    const tenant = await call('http://bhutan.sourcelibrary.org/api/search/semantic?q=hartmann', { 'x-tenant-id': TENANT });
    expect(tenant.body.mode).toBe('lexical');
    expect(tenant.body.results.map((r: any) => r.book_id).sort()).toEqual(OWN);
  });

  it('an unresolvable tenant gets nothing, and the query layer is never called', async () => {
    rpc.mockImplementation(() => { throw new Error('the query layer must not be called'); });
    const out = await call('http://nope.sourcelibrary.org/api/search/semantic?q=alchemy', { 'x-tenant-slug': 'no-such-tenant' });
    expect(out.body.results).toEqual([]);
    expect(out.cache).toBe('private, no-store');
    expect(rpc).not.toHaveBeenCalled();
  });
});
