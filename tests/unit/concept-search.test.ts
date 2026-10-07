import { describe, it, expect, vi, beforeEach } from 'vitest';

// The one function the concept lanes share (#3514, #5729): English vectors +
// the original-text lane, fused, hidden books out, spread, snippets filled.

const state = {
  english: [] as any[],
  original: { rows: [] as any[], state: 'off' as string },
  books: [] as any[],
  pages: [] as any[],
  mongoFails: false,
};
const cursor = (rows: any[]) => ({ toArray: async () => rows });
const db = {
  collection: (name: string) => ({
    find: (filter: any) => {
      if (state.mongoFails) throw new Error('mongo down');
      const ids: string[] = filter.id.$in;
      return cursor((name === 'books' ? state.books : state.pages).filter((d) => ids.includes(d.id)));
    },
  }),
};
vi.mock('@/lib/mongodb', () => ({ getDb: async () => db }));
vi.mock('@/lib/semantic-search', () => ({
  semanticPageSearchGlobal: async () => state.english,
  semanticPageSearchUntranslated: async () => state.original,
}));

const en = (book: string, page: number, score: number) => ({ page_id: `${book}:${page}`, book_id: book, page_number: page, snippet: `en ${book} ${page}`, snippet_type: 'translation', score, book_title: book, book_author: null, book_language: 'Latin', book_year: 1600 });
const orig = (book: string, page: number, score: number) => ({ ...en(book, page, score), snippet: '', snippet_type: 'ocr' });
const book = (id: string, tradition: string[], extra: Record<string, unknown> = {}) => ({ id, slug: `slug-${id}`, tradition, work_id: `w-${id}`, visible: true, ...extra });
const GLOBAL = { kind: 'global' as const };

beforeEach(() => {
  state.english = []; state.original = { rows: [], state: 'off' }; state.books = []; state.pages = []; state.mongoFails = false;
});

describe('conceptPageSearch', () => {
  it('spreads the English lane across traditions and tags each row', async () => {
    const { conceptPageSearch } = await import('@/lib/search/concept-search');
    state.english = [en('l1', 1, 0.80), en('l2', 1, 0.795), en('l3', 1, 0.79), en('zh', 1, 0.787), en('ar', 1, 0.784)];
    state.books = [book('l1', ['Medieval Latin']), book('l2', ['Medieval Latin']), book('l3', ['Medieval Latin']), book('zh', ['Chinese']), book('ar', ['Arabic'])];
    const out = await conceptPageSearch('the one', 4, { scope: GLOBAL, diversity: 'tradition' });
    expect(out.rows.map((r) => r.book_id)).toEqual(['l1', 'l2', 'zh', 'ar']);
    expect(out.rows[2]).toMatchObject({ tradition: ['Chinese'], text_lane: 'translated', slug: 'slug-zh' });
    expect(out.traditions).toEqual({ 'medieval-europe': 2, 'east-asian': 1, islamic: 1 });
    expect(out.diversity).toBe('tradition');
    expect(out.lanes.untranslated).toBe('off');
  });

  it('off keeps the lane order', async () => {
    const { conceptPageSearch } = await import('@/lib/search/concept-search');
    state.english = [en('l1', 1, 0.80), en('l2', 1, 0.795), en('l3', 1, 0.79), en('zh', 1, 0.785)];
    state.books = ['l1', 'l2', 'l3'].map((b) => book(b, ['Medieval Latin'])).concat([book('zh', ['Chinese'])]);
    const out = await conceptPageSearch('q', 4, { scope: GLOBAL, diversity: 'off' });
    expect(out.rows.map((r) => r.book_id)).toEqual(['l1', 'l2', 'l3', 'zh']);
  });

  it('drops hidden and deleted books before the caps are counted', async () => {
    const { conceptPageSearch } = await import('@/lib/search/concept-search');
    state.english = [en('hid', 1, 0.9), en('gone', 1, 0.89), en('l1', 1, 0.8), en('l2', 1, 0.79)];
    state.books = [book('hid', ['Medieval Latin'], { hidden: true }), book('l1', ['Medieval Latin']), book('l2', ['Medieval Latin'])];
    const out = await conceptPageSearch('q', 10, { scope: GLOBAL, diversity: 'tradition' });
    expect(out.rows.map((r) => r.book_id)).toEqual(['l1', 'l2']);
  });

  it('a Mongo failure re-ranks nothing and drops nothing', async () => {
    const { conceptPageSearch } = await import('@/lib/search/concept-search');
    state.english = [en('l1', 1, 0.8), en('l2', 1, 0.79), en('l3', 1, 0.78)];
    state.mongoFails = true;
    const out = await conceptPageSearch('q', 10, { scope: GLOBAL, diversity: 'tradition' });
    expect(out.rows.map((r) => r.book_id)).toEqual(['l1', 'l2', 'l3']);
    expect(out.diversity).toBe('off');
  });

  it('interleaves the original-text lane, holds it to three a screen, and reads its snippet from the OCR', async () => {
    const { conceptPageSearch, ORIGINAL_PER_SCREEN } = await import('@/lib/search/concept-search');
    state.english = Array.from({ length: 10 }, (_, i) => en(`e${i}`, 1, 0.8 - i / 100));
    state.original = { rows: Array.from({ length: 6 }, (_, i) => orig(`o${i}`, 7, 0.7 - i / 100)), state: 'ok' };
    state.books = [...state.english, ...state.original.rows].map((r) => book(r.book_id, []));
    state.pages = state.original.rows.map((r) => ({ id: r.page_id, ocr: { data: `<meta>AI note about another page</meta><language>Latin</language>Prima materia est ${r.book_id} <note>gloss</note>` } }));
    const out = await conceptPageSearch('first matter', 10, { scope: GLOBAL, diversity: 'off' });
    const lanes = out.rows.map((r) => r.text_lane);
    expect(lanes.filter((l) => l === 'original')).toHaveLength(ORIGINAL_PER_SCREEN);
    expect(lanes.slice(0, 2)).toEqual(['translated', 'original']);
    const first = out.rows.find((r) => r.text_lane === 'original')!;
    expect(first.snippet_type).toBe('ocr');
    expect(first.snippet).toContain('Prima materia est o0');
    // Wrapper prose never reaches a snippet (quote-and-snippet-integrity.md).
    expect(first.snippet).not.toContain('AI note');
    expect(out.lanes.untranslated).toBe('ok');
  });

  it('an original-text row with no OCR to show is dropped, not served empty', async () => {
    const { conceptPageSearch } = await import('@/lib/search/concept-search');
    state.english = [en('e0', 1, 0.8), en('e1', 1, 0.79), en('e2', 1, 0.78)];
    state.original = { rows: [orig('o0', 7, 0.7)], state: 'ok' };
    state.books = ['e0', 'e1', 'e2', 'o0'].map((b) => book(b, []));
    const out = await conceptPageSearch('q', 10, { scope: GLOBAL, diversity: 'off' });
    expect(out.rows.map((r) => r.book_id)).toEqual(['e0', 'e1', 'e2']);
  });

  it('an English-lane row with no stored translation is served from its OCR, not blank', async () => {
    const { conceptPageSearch } = await import('@/lib/search/concept-search');
    state.english = [en('e0', 1, 0.8), { ...en('lat', 4, 0.79), snippet: '' }, { ...en('void', 2, 0.78), snippet: '' }, en('e1', 1, 0.7)];
    state.books = ['e0', 'lat', 'void', 'e1'].map((b) => book(b, []));
    state.pages = [{ id: 'lat:4', ocr: { data: 'De prima materia lapidis.' } }];
    const out = await conceptPageSearch('q', 10, { scope: GLOBAL, diversity: 'off' });
    expect(out.rows.map((r) => r.book_id)).toEqual(['e0', 'lat', 'e1']);
    expect(out.rows[1]).toMatchObject({ text_lane: 'original', snippet_type: 'ocr', snippet: 'De prima materia lapidis.' });
  });

  it('a closed scope asks nothing and returns nothing', async () => {
    const { conceptPageSearch } = await import('@/lib/search/concept-search');
    state.english = [en('l1', 1, 0.8)];
    const out = await conceptPageSearch('q', 10, { scope: { kind: 'closed', reason: 'x' }, diversity: 'tradition' });
    expect(out.rows).toEqual([]);
    expect(out.lanes.untranslated).toBe('closed');
  });

  it('max_per_book still holds', async () => {
    const { conceptPageSearch } = await import('@/lib/search/concept-search');
    state.english = [en('l1', 1, 0.8), en('l1', 2, 0.79), en('l1', 3, 0.78), en('l2', 1, 0.7)];
    state.books = [book('l1', []), book('l2', [])];
    const out = await conceptPageSearch('q', 10, { scope: GLOBAL, diversity: 'off', maxPerBook: 1 });
    expect(out.rows.map((r) => `${r.book_id}:${r.page_number}`)).toEqual(['l1:1', 'l2:1']);
  });
});
