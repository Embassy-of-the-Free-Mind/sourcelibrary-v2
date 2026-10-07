import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Route-level guard for #5921. Runs the real /api/search handler over a fake
// corpus in which EVERY lane proposes EVERY book, so a lane that does not apply
// a book-level filter shows up as a row from a book the filter excludes.
// Before the fix `library=<no such library>` returned passages, because the
// keyword page lane and both semantic lanes built their own, shorter filters.
//
// The fake `books.find` evaluates the Mongo filter it is handed (a fake that
// ignores the filter would pass whatever the route did).

const BOOKS: Array<Record<string, any>> = [
  { id: 'bph-ft', title: 'Aurora', author: 'Boehme', language: 'German', year: 1612, published: '1612', pages_count: 100, pages_translated: 100, visible: true, held_by: 'bph', is_first_translation: true, categories: ['theosophy'], doi: '10.1/x' },
  { id: 'bph-raw', title: 'Mysterium', author: 'Boehme', language: 'German', year: 1623, published: '1623', pages_count: 100, pages_translated: 0, visible: true, image_source: { provider: 'bph' }, categories: ['theosophy'] },
  { id: 'ia-tr', title: 'Opera', author: 'Paracelsus', language: 'Latin', year: 1603, published: '1603', pages_count: 100, pages_translated: 40, visible: true, held_by: 'internet_archive', categories: ['medicine'] },
  { id: 'ia-raw', title: 'Tractatus', author: 'Anon', language: 'Latin', year: 1650, published: '1650', pages_count: 100, pages_translated: 0, visible: true, image_source: { provider: 'internet_archive' }, categories: ['alchemy'] },
  // Not published: must never come back, with or without a filter.
  { id: 'unlisted', title: 'Withheld', author: 'Anon', language: 'Latin', year: 1600, published: '1600', pages_count: 100, pages_translated: 100, visible: false, held_by: 'bph', is_first_translation: true, categories: ['theosophy'] },
];
const ALL = BOOKS.map(b => b.id);
const LIVE = ALL.filter(id => id !== 'unlisted');

const get = (doc: any, path: string) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc);
/** The subset of Mongo's query language the route's book filters use. */
function matches(doc: any, filter: Record<string, any>): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$or') return (cond as any[]).some(f => matches(doc, f));
    if (key === '$and') return (cond as any[]).every(f => matches(doc, f));
    const value = get(doc, key);
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof RegExp)) {
      return Object.entries(cond).every(([op, arg]: [string, any]) => {
        switch (op) {
          case '$in': return Array.isArray(value) ? value.some(v => arg.includes(v)) : arg.includes(value);
          case '$nin': return !arg.includes(value);
          case '$gt': return typeof value === 'number' && value > arg;
          case '$gte': return typeof value === 'number' && value >= arg;
          case '$lte': return typeof value === 'number' && value <= arg;
          case '$ne': return value !== arg && !(arg === null && value === undefined);
          case '$exists': return (value !== undefined) === arg;
          default: throw new Error(`fake books.find: operator ${op} is not modelled`);
        }
      });
    }
    return Array.isArray(value) ? value.includes(cond) : value === cond;
  });
}

function cursor(rows: any[]) {
  let n = Infinity;
  const c: any = {
    project: () => c, maxTimeMS: () => c,
    limit: (k: number) => { n = k; return c; },
    toArray: async () => rows.slice(0, n),
  };
  return c;
}
const page = (book_id: string) => ({
  id: `${book_id}:7`, book_id, page_number: 7,
  translation: { data: `… the tincture, in ${book_id} …` }, ocr: { data: '' },
});
const state = vi.hoisted(() => ({ ignoreBookFilters: false }));
const db = {
  collection: (name: string) => name === 'books'
    ? { find: (filter: any) => cursor(BOOKS.filter(b => state.ignoreBookFilters ? (filter.id?.$in ?? ALL).includes(b.id) : matches(b, filter))) }
    : {
        find: () => cursor([]),
        aggregate: (pipeline: any[]) => {
          const first = pipeline[0];
          if (first.$searchMeta) return cursor([]); // roll-up: nothing to add
          const filters: any[] = first.$search.compound.filter ?? [];
          const allow = filters.find(f => f.in?.path === 'book_id')?.in.value as string[] | undefined;
          const none = filters.some(f => f.equals?.path === 'book_id');
          // Atlas would honour the allow-list; pages of every book otherwise.
          return cursor(none ? [] : ALL.filter(id => !allow || allow.includes(id)).map(page));
        },
      },
};

vi.mock('@/lib/api-auth', () => ({ withApiAuth: (h: any) => (req: any, ctx: any) => h(req, ctx, null) }));
vi.mock('@/lib/mongodb', () => ({ getReadDb: async () => db, getDb: async () => db }));
vi.mock('@/lib/books-catalog', () => ({ searchBookIds: async () => ALL }));
vi.mock('@/lib/search/name-variants', () => ({ expandNameQuery: async () => ({ variants: [], topicWords: [] }) }));
vi.mock('@/lib/semantic-search', () => ({
  // Vector lanes carry no metadata predicate: they propose every book.
  semanticBookSearch: async () => BOOKS.map(b => ({ book_id: b.id, similarity: 0.9, summary_text: 's', title: b.title, author: b.author, language: b.language, year: b.year })),
  semanticPageSearchGlobal: async () => BOOKS.map(b => ({ page_id: `${b.id}:9`, book_id: b.id, page_number: 9, snippet: 'sem', book_year: b.year })),
  lexicalPageSearchLang: async () => [],
}));
vi.mock('@/lib/search/work-fanout', () => ({ fetchWorkFanouts: async () => new Map() }));
vi.mock('@/lib/search-log', () => ({ logSearchQuery: () => {} }));
vi.mock('@/lib/search-event-log', () => ({ logSearchEvent: () => {} }));

async function search(params: string) {
  const { GET } = await import('@/app/api/search/route');
  const res = await (GET as any)(new NextRequest(`http://localhost/api/search?q=tincture&limit=100&${params}`), { params: Promise.resolve({}) });
  return res.json();
}
/** Book ids per row type. A book appears as a row, as keyword passages, as semantic passages. */
const ids = (body: any, type?: 'book' | 'page') => [...new Set(
  (body.results as any[]).filter(r => !type || r.type === type).map(r => r.book_id as string),
)].sort();

beforeEach(() => { state.ignoreBookFilters = false; });

describe('/api/search applies every book-level filter in every lane (#5921)', () => {
  it('control: unfiltered, every lane returns every published book', async () => {
    const full = await search('');
    expect(ids(full, 'book')).toEqual([...LIVE].sort());
    const passages = await search('pages_only=true');
    expect(ids(passages, 'page')).toEqual([...LIVE].sort());
    // Keyword page 7 and semantic page 9 of each: both passage lanes are live.
    expect(passages.results.map((r: any) => r.page_number).sort()).toEqual([7, 7, 7, 7, 9, 9, 9, 9]);
  });

  it('control: the fake corpus leaks when the books lookup ignores its filter', async () => {
    state.ignoreBookFilters = true;
    expect((await search('library=zzz-no-such-library&pages_only=true')).total).toBeGreaterThan(0);
  });

  it.each(['', 'pages_only=true&'])('an impossible library returns 0 rows (%s)', async (mode) => {
    const body = await search(`${mode}library=zzz-no-such-library`);
    expect(body.results).toEqual([]);
    expect(body.total).toBe(0);
  });

  it.each([
    ['library=bph', ['bph-ft', 'bph-raw']],                 // held_by OR image_source.provider
    ['has_translation=true', ['bph-ft', 'ia-tr']],
    ['first_translation=true', ['bph-ft']],
    ['category=medicine', ['ia-tr']],
    ['has_doi=true', ['bph-ft']],
    ['language=Latin&has_translation=true', ['ia-tr']],
    ['category=zzz-none', []],
  ])('%s: books and passages only from %j', async (params, expected) => {
    const full = await search(params);
    expect(ids(full)).toEqual(expected);
    const passages = await search(`pages_only=true&${params}`);
    expect(ids(passages, 'page')).toEqual(expected);
    // Both passage lanes answered for each admitted book — the filter narrowed
    // them, it did not just switch them off.
    expect(passages.results.map((r: any) => r.page_number).sort())
      .toEqual([...expected.map(() => 7), ...expected.map(() => 9)]);
  });

  it('never returns a passage from a book that is not published', async () => {
    for (const params of ['', 'pages_only=true', 'first_translation=true', 'library=bph&pages_only=true']) {
      expect(ids(await search(params))).not.toContain('unlisted');
    }
  });

  it('reports the filters it applied', async () => {
    const body = await search('library=bph&first_translation=true');
    expect(body.filters).toMatchObject({ library: 'bph', first_translation: 'true' });
  });
});
