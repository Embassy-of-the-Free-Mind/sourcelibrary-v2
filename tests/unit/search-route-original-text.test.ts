import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Route-level guard for #7175. `/la/search` and `/zh/search` serve readers of
// the original. Before this, `/api/search?lang=la` narrowed to
// `pages_translated_la > 0`, which no book has, and answered 0 rows without a
// word; and every page row quoted the English translation.
//
// The fake corpus: a Latin book, a Chinese book and a German one, each with an
// English translation and its own OCR on page 7. Every lane proposes every
// book, and the fake `books.find` evaluates the filter it is handed.

const BOOKS: Array<Record<string, any>> = [
  { id: 'lat', title: 'Tractatus', author: 'Anon', language: 'Latin', year: 1600, published: '1600', pages_count: 100, pages_translated: 100, visible: true },
  { id: 'zho', title: '黃帝內經', author: '佚名', language: 'Chinese', year: 1600, published: '1600', pages_count: 100, pages_translated: 100, visible: true },
  { id: 'ger', title: 'Aurora', author: 'Boehme', language: 'German', year: 1612, published: '1612', pages_count: 100, pages_translated: 100, visible: true },
];
const ALL = BOOKS.map(b => b.id);
const OCR: Record<string, string> = {
  lat: 'Prooemium. Multa dicuntur de arte, sed hic lapis philoſophorum vniuerſum mundum tingit.',
  zho: '黃帝問曰：夫陰陽者，天地之道也。',
  ger: 'Vorrede. Die Morgenröte im Aufgang.',
};
const ENGLISH = (id: string) => `In English: the philosophers' stone of ${id}, yin and yang.`;

const get = (doc: any, path: string) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc);
function matches(doc: any, filter: Record<string, any>): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === '$or') return (cond as any[]).some(f => matches(doc, f));
    const value = get(doc, key);
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof RegExp)) {
      return Object.entries(cond).every(([op, arg]: [string, any]) => {
        switch (op) {
          case '$in': return arg.includes(value);
          case '$gt': return typeof value === 'number' && value > arg;
          case '$ne': return value !== arg;
          default: throw new Error(`fake find: operator ${op} is not modelled`);
        }
      });
    }
    return value === cond;
  });
}
function cursor(rows: any[]) {
  let n = Infinity;
  const c: any = { project: () => c, maxTimeMS: () => c, limit: (k: number) => { n = k; return c; }, toArray: async () => rows.slice(0, n) };
  return c;
}
const pageDoc = (book_id: string, n: number) => ({
  id: `${book_id}:${n}`, book_id, page_number: n,
  translation: { data: ENGLISH(book_id) }, ocr: { data: OCR[book_id] },
});
const db = {
  collection: (name: string) => name === 'books'
    ? { find: (filter: any) => cursor(BOOKS.filter(b => matches(b, filter))), aggregate: () => cursor([]) }
    : {
        find: (filter: any) => cursor(ALL.flatMap(id => [pageDoc(id, 7), pageDoc(id, 9)]).filter(p => !filter?.id?.$in || filter.id.$in.includes(p.id))),
        aggregate: (pipeline: any[]) => {
          const first = pipeline[0];
          if (first.$searchMeta) return cursor([]);
          const filters: any[] = first.$search.compound.filter ?? [];
          const allow = filters.find(f => f.in?.path === 'book_id')?.in.value as string[] | undefined;
          // Atlas highlights the English, as it does for a translated page.
          return cursor(ALL.filter(id => !allow || allow.includes(id)).map(id => ({
            ...pageDoc(id, 7),
            highlights: [{ path: 'translation.data', texts: [{ value: 'stone', type: 'hit' }] }],
          })));
        },
      },
};

vi.mock('@/lib/api-auth', () => ({ withApiAuth: (h: any) => (req: any, ctx: any) => h(req, ctx, null) }));
vi.mock('@/lib/mongodb', () => ({ getReadDb: async () => db, getDb: async () => db }));
vi.mock('@/lib/books-catalog', () => ({ searchBookIds: async () => ALL }));
vi.mock('@/lib/search/name-variants', () => ({ expandNameQuery: async () => ({ variants: [], topicWords: [] }) }));
vi.mock('@/lib/semantic-search', () => ({
  semanticBookSearch: async () => [],
  // The semantic page lane quotes English, as it does for a translated page.
  semanticPageSearchGlobal: async () => BOOKS.map(b => ({ page_id: `${b.id}:9`, book_id: b.id, page_number: 9, snippet: ENGLISH(b.id), book_year: b.year })),
  semanticPageSearchUntranslated: async () => ({ rows: [], state: 'off' }),
  getQueryEmbedding: async () => null,
  lexicalPageSearchLang: async () => [],
}));
vi.mock('@/lib/search/work-fanout', () => ({ fetchWorkFanouts: async () => new Map() }));
vi.mock('@/lib/search-log', () => ({ logSearchQuery: () => {} }));
vi.mock('@/lib/search-event-log', () => ({ logSearchEvent: () => {} }));

async function search(params: string) {
  const { GET } = await import('@/app/api/search/route');
  const res = await (GET as any)(new NextRequest(`http://localhost/api/search?limit=100&${params}`), { params: Promise.resolve({}) });
  return { status: res.status as number, body: await res.json() };
}
const pages = (body: any) => (body.results as any[]).filter(r => r.type === 'page');
const bookIds = (body: any) => [...new Set((body.results as any[]).map(r => r.book_id as string))].sort();

describe('/api/search on an original-text locale (#7175)', () => {
  it('control: an English request quotes the English translation', async () => {
    const { body } = await search('q=lapis%20philosophorum');
    expect(bookIds(body)).toEqual([...ALL].sort());
    expect(pages(body).length).toBeGreaterThan(0);
    expect(pages(body).every(r => r.snippet_type === 'translation' && r.snippet.includes('In English'))).toBe(true);
  });

  it('lang=la answers with Latin books, not a silent 0', async () => {
    const { status, body } = await search('q=lapis%20philosophorum&lang=la');
    expect(status).toBe(200);
    expect(body.total).toBeGreaterThan(0);
    expect(bookIds(body)).toEqual(['lat']);
    expect(body.filters.language).toBe('Latin');
  });

  it('lang=zh answers with Chinese books', async () => {
    const { body } = await search(`q=${encodeURIComponent('陰陽')}&lang=zh`);
    expect(bookIds(body)).toEqual(['zho']);
    for (const r of pages(body)) {
      expect(r.snippet_type).toBe('ocr');
      expect(r.snippet).toContain('陰陽');
    }
  });

  it.each([
    'q=lapis%20philosophorum&lang=la&pages_only=true',
    'q=lapis%20philosophorum&language=Latin&text=original&pages_only=true',
  ])('%s: every page row quotes the OCR, cut at the folded match', async (params) => {
    const { body } = await search(params);
    const rows = pages(body);
    // Both passage lanes answered: the keyword page (7) and the semantic one (9).
    expect(rows.map(r => r.page_number).sort()).toEqual([7, 9]);
    for (const r of rows) {
      expect(r.snippet_type).toBe('ocr');
      expect(r.snippet).not.toContain('In English');
      // "philosophorum" found in "philoſophorum": the excerpt keeps the print.
      expect(r.snippet).toContain('lapis philoſophorum');
    }
    expect(body.text).toBe('original');
  });

  it('control: the same passage request without the flag quotes the English', async () => {
    const { body } = await search('q=lapis%20philosophorum&language=Latin&pages_only=true');
    expect(pages(body).length).toBe(2);
    expect(pages(body).every(r => r.snippet.includes('In English'))).toBe(true);
  });

  it('a book row carries no English summary on an original-text request', async () => {
    const { body } = await search('q=lapis%20philosophorum&lang=la');
    for (const r of (body.results as any[]).filter(r => r.type === 'book')) expect(r.summary).toBeUndefined();
  });

  it('refuses a language that contradicts the locale, with a reason', async () => {
    const { status, body } = await search('q=lapis&lang=la&language=German');
    expect(status).toBe(400);
    expect(body.error).toMatch(/lang=la.*Latin/);
  });

  it('refuses an unknown text= value', async () => {
    const { status } = await search('q=lapis&text=modern');
    expect(status).toBe(400);
  });

  it('lang=es keeps its meaning: the Spanish edition store', async () => {
    // No book has pages_translated_es here, so the Spanish lane is empty, as before.
    const { status, body } = await search('q=lapis&lang=es');
    expect(status).toBe(200);
    expect(body.total).toBe(0);
  });
});
