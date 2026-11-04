/**
 * Page renumber (#5699): maps, per-store remaps, undo, and the read-back engine.
 *
 * What these pin: a renumber is a permutation (olds == news as sets), every number-only store goes through
 * the same f, applying the inverse moves gives back the original exactly (ranges that straddle a moved
 * block are recorded and restored instead), and the engine STOPS on the first store whose read-back
 * differs from the plan — including the case where Mongo reads back right and the Supabase copy does not.
 */
import { describe, it, expect } from 'vitest';

import {
  expandSegments, validateMoves, invertMoves, makeMapper, mapNumberArray, mapRange,
  remapEntityBooks, remapBookIndex, remapChapters, remapQuote, runStores, verifyKeyed,
  planPageNumberCopy, RenumberMismatch,
} from '../../scripts/lib/page-renumber.mjs';
import { computeEndPages } from '../../scripts/lib/chapter-endpages.mjs';

const book = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, page_number: i + 1 }));

describe('expandSegments', () => {
  it('reverses a part: n → from + to − n', () => {
    const moves = expandSegments(book(10), [{ op: 'reverse', from: 4, to: 8 }]);
    expect(moves.map((m: any) => [m.old, m.new])).toEqual([[4, 8], [5, 7], [7, 5], [8, 4]]);
    expect(moves[0].page_id).toBe('p4');
  });
  it('pair-swaps', () => {
    const moves = expandSegments(book(6), [{ op: 'pairswap', from: 1, to: 6 }]);
    expect(moves.map((m: any) => [m.old, m.new])).toEqual([[1, 2], [2, 1], [3, 4], [4, 3], [5, 6], [6, 5]]);
  });
  it('takes an explicit rotation', () => {
    const moves = expandSegments(book(200), [{ op: 'explicit', pairs: [[159, 161], [160, 159], [161, 160]] }]);
    expect(moves.map((m: any) => [m.old, m.new])).toEqual([[159, 161], [160, 159], [161, 160]]);
  });
  it('refuses a non-permutation, a missing page, overlap, and duplicate numbers', () => {
    expect(() => expandSegments(book(5), [{ op: 'explicit', pairs: [[1, 2]] }])).toThrow(/permutation/);
    expect(() => expandSegments(book(5), [{ op: 'reverse', from: 3, to: 9 }])).toThrow(/does not have/);
    expect(() => expandSegments(book(9), [{ op: 'reverse', from: 1, to: 5 }, { op: 'reverse', from: 5, to: 9 }])).toThrow(/two segments/);
    expect(() => expandSegments([...book(3), { id: 'x', page_number: 2 }], [])).toThrow(/two pages/);
    expect(() => expandSegments(book(5), [{ op: 'pairswap', from: 1, to: 5 }])).toThrow(/odd/);
  });
});

describe('undo is the inverse map', () => {
  const moves = expandSegments(book(20), [{ op: 'reverse', from: 5, to: 15 }]);
  const f = makeMapper(moves);
  const g = makeMapper(invertMoves(moves));
  it('g∘f is the identity on numbers and on sorted arrays', () => {
    for (let n = 1; n <= 25; n++) expect(g(f(n))).toBe(n);
    const arr = [1, 4, 5, 6, 12, 15, 16];
    expect(mapNumberArray(mapNumberArray(arr, f), g)).toEqual(arr);
    expect(mapNumberArray(arr, f)).toEqual([1, 4, 5, 8, 14, 15, 16]);
  });
  it('validates the inverse', () => expect(validateMoves(invertMoves(moves))).toBe(true));
  it('a range inside the block maps exactly; one that straddles it widens and says so', () => {
    expect(mapRange(6, 8, f)).toMatchObject({ start: 12, end: 14, exact: true });
    expect(mapRange(3, 6, f)).toMatchObject({ start: 3, end: 15, exact: false });
  });
  it('entity page_range that widens is recorded, and the undo restores it', () => {
    const rec: any = {};
    const record = (s: string, k: string, before: any, after: any) => { (rec[s] ??= {})[k] = { before, after }; };
    const books = [{ book_id: 'B', pages: [3, 6], page_precision: 'page' }, { book_id: 'B', pages: [], page_precision: 'section', page_range: { start: 3, end: 6 } }, { book_id: 'C', pages: [6] }];
    const fwd = remapEntityBooks(books, 'B', f, { restore: null, key: 'e1', record });
    expect(fwd[0].pages).toEqual([3, 14]);
    expect(fwd[1].page_range).toEqual({ start: 3, end: 15 });
    expect(fwd[2]).toBe(books[2]);
    expect(rec['entities.page_range']['e1#1']).toBeTruthy();
    const back = remapEntityBooks(fwd, 'B', g, { restore: rec, key: 'e1', record: () => {} });
    expect(back).toEqual(books);
  });
});

describe('book_indexes, chapters, quotes', () => {
  const moves = expandSegments(book(10), [{ op: 'reverse', from: 1, to: 10 }]);
  const f = makeMapper(moves);
  const g = makeMapper(invertMoves(moves));
  const newOf = (id: string) => { const m = moves.find((x: any) => x.page_id === id); return m ? m.new : undefined; };
  it('remaps term arrays, page summaries, section ranges and nested quotes; undo restores', () => {
    const doc = { vocabulary: [{ term: 'a', pages: [1, 2, 9] }], pageSummaries: [{ page: 1, summary: 's' }], sectionSummaries: [{ startPage: 2, endPage: 4, quotes: [{ page: 3, page_id: 'p3' }] }] };
    const set = remapBookIndex(doc, f, newOf, { restore: null, record: () => {}, key: 'd' });
    expect(set.vocabulary[0].pages).toEqual([2, 9, 10]);
    expect(set.pageSummaries[0].page).toBe(10);
    expect(set.sectionSummaries[0]).toMatchObject({ startPage: 7, endPage: 9, quotes: [{ page: 8 }] });
    const after = { ...doc, ...set };
    const oldOf = (id: string) => Number(id.slice(1));
    const back = remapBookIndex(after, g, oldOf, { restore: null, record: () => {}, key: 'd' });
    expect({ ...after, ...back }).toEqual(doc);
  });
  it('a quote follows its page id', () => expect(remapQuote({ page: 2, page_id: 'p2' }, f, newOf).page).toBe(9));
  it('chapters re-sort into the new order and endPage is recomputed; undo restores the record', () => {
    const rec: any = {};
    const record = (s: string, k: string, before: any, after: any) => { (rec[s] ??= {})[k] = { before, after }; };
    const ch = [{ title: 'A', pageId: 'p2', pageNumber: 2, level: 1, endPage: 5 }, { title: 'B', pageId: 'p6', pageNumber: 6, level: 1, endPage: 10 }];
    const next = remapChapters(ch, f, newOf, 10, computeEndPages, { restore: null, record });
    expect(next.map((c: any) => [c.title, c.pageNumber, c.endPage])).toEqual([['B', 5, 8], ['A', 9, 10]]);
    expect(remapChapters(next, g, (id: string) => Number(id.slice(1)), 10, computeEndPages, { restore: rec, record: () => {} })).toEqual(ch);
  });
});

describe('runStores — read back every store, stop on the first mismatch', () => {
  const moves = expandSegments(book(4), [{ op: 'reverse', from: 1, to: 4 }]);
  // A keyed in-memory store; `corrupt` makes its read-back lie about one row.
  function store(name: string, init: Map<string, number>, opts: { corrupt?: boolean } = {}) {
    const data = new Map(init);
    let writes = 0;
    return {
      data, get writes() { return writes; },
      name,
      read: async () => {
        const m = new Map(data);
        if (opts.corrupt && writes) m.set('p1', 1); // the write "landed" but reads back the old number
        return m;
      },
      plan: (state: Map<string, number>) => planPageNumberCopy(state, moves),
      write: async (w: [string, number][]) => { for (const [k, n] of w) data.set(k, n); writes++; return w.length; },
      verify: verifyKeyed,
    };
  }
  const init = () => new Map([['p1', 1], ['p2', 2], ['p3', 3], ['p4', 4], ['other', 9]]);

  it('clean: every store written and read back', async () => {
    const a = store('mongo.pages', init()), b = store('supabase.page_translations', init());
    const done: string[] = [];
    const rep = await runStores([a, b], { apply: true, onStoreDone: async (n: string) => { done.push(n); } });
    expect(rep.map((r: any) => r.written)).toEqual([4, 4]);
    expect(done).toEqual(['mongo.pages', 'supabase.page_translations']);
    expect([...b.data]).toEqual([['p1', 4], ['p2', 3], ['p3', 2], ['p4', 1], ['other', 9]]);
  });

  it('two stores: Mongo reads back right, the Supabase copy does not → throws naming it, and nothing after it runs', async () => {
    const a = store('mongo.pages', init());
    const b = store('supabase.page_translations', init(), { corrupt: true });
    const c = store('mongo.entities', init());
    const done: string[] = [];
    await expect(runStores([a, b, c], { apply: true, onStoreDone: async (n: string) => { done.push(n); } }))
      .rejects.toThrow(RenumberMismatch);
    expect(done).toEqual(['mongo.pages']);
    expect(c.writes).toBe(0);
    expect([...c.data]).toEqual([...init()]);
  });

  it('a row the plan did not touch must read back unchanged', () => {
    const before = new Map([['p1', 1], ['x', 7]]);
    const after = new Map([['p1', 4], ['x', 8]]);
    const mm = verifyKeyed(after, new Map([['p1', 4]]), before);
    expect(mm).toEqual([{ key: 'x', expected: 7, got: 8, untouched: true }]);
  });

  it('dry run writes nothing', async () => {
    const a = store('mongo.pages', init());
    const rep = await runStores([a], { apply: false });
    expect(a.writes).toBe(0);
    expect(rep[0]).toMatchObject({ planned: 4, written: 0 });
  });

  it('a copy that was stale before is still set by page id, and counted', () => {
    const p = planPageNumberCopy(new Map([['p1', 2], ['p2', 2]]), moves);
    expect(p.stale).toBe(1);
    expect([...p.expected]).toEqual([['p1', 4], ['p2', 3]]);
  });
});
