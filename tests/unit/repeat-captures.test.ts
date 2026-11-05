import { describe, it, expect } from 'vitest';
import { planBookRepeats, namesOcclusion, wordCount } from '../../scripts/lib/repeat-captures.mjs';
import { readerPageListFilter, isReaderListedPage, READER_HIDDEN_PAGE_TYPES, readerPageCountFilters, countReaderListedPages, resolveRepeatKeeper, resolveRepeatKeepers, mapChapterPageIds } from '@/lib/reader-pages';
import { VISIBLE_PAGE_MATCH as TS_VISIBLE, isRepeatCapture } from '@/lib/page-counts';
import { resolvePageIdsByNumber } from '@/lib/page-number-resolve';
import { classifyRepeatTarget, FAILING } from '../../scripts/audit/repeat-of-orphans.mjs';
import { VISIBLE_PAGE_MATCH as MJS_VISIBLE, isVisiblePage } from '../../scripts/lib/page-counts.mjs';

const words = (n: number, seed = 'w') => Array.from({ length: n }, (_, i) => `${seed}${i}`).join(' ');
const page = (id: string, n: number, w: number, extra: Record<string, unknown> = {}) =>
  ({ id, book_id: 'B', page_number: n, ocr: { data: words(w) }, ...extra });
const byId = (...ps: Record<string, unknown>[]) => new Map(ps.map(p => [p.id as string, p]));

describe('reader page list (#5056)', () => {
  it('the Mongo filter keeps page 0, drops negatives and repeat captures', () => {
    expect(readerPageListFilter('B')).toEqual({ book_id: 'B', page_number: { $gte: 0 }, repeat_of: null });
  });

  it('isReaderListedPage drops repeat captures, hidden page types and negatives, nothing else', () => {
    expect(isReaderListedPage({ page_number: 3 })).toBe(true);
    expect(isReaderListedPage({ page_number: 0 })).toBe(true);
    expect(isReaderListedPage({ page_number: 3, repeat_of: null })).toBe(true);
    expect(isReaderListedPage({ page_number: 3, repeat_of: 'kept' })).toBe(false);
    expect(isReaderListedPage({ page_number: -3 })).toBe(false);
    expect(isReaderListedPage({ page_number: 3, page_type: 'digitizer-insert' })).toBe(false);
    expect(isReaderListedPage({ page_number: 3, page_type: 'archived-spread' })).toBe(false);
    expect(isReaderListedPage({ page_number: 3, page_type: 'title-page' })).toBe(true);
    expect(isReaderListedPage(null)).toBe(false);
  });

  it('wires HIDDEN_PAGE_TYPES rather than a private copy', () => {
    expect([...READER_HIDDEN_PAGE_TYPES].sort()).toEqual(['archived-spread', 'digitizer-insert']);
  });

  it('a book L, L, R, R pages through as L, R once the repeats are marked', () => {
    const book = [
      { id: 'a', page_number: 5 }, { id: 'b', page_number: 6 },
      { id: 'c', page_number: 7, repeat_of: 'a' }, { id: 'd', page_number: 8, repeat_of: 'b' },
      { id: 'e', page_number: 9 },
    ];
    const list = book.filter(isReaderListedPage);
    expect(list.map(p => p.page_number)).toEqual([5, 6, 9]);
    // Numbers are untouched: next from p.6 is p.9, and p.7/p.8 still exist under their own numbers.
    expect(list[list.findIndex(p => p.id === 'b') + 1].page_number).toBe(9);
    expect(book.find(p => p.id === 'c')!.page_number).toBe(7);
  });

  it('counts: both twins leave a repeat capture out, and unsetting it restores the page', () => {
    expect(TS_VISIBLE).toEqual(MJS_VISIBLE);
    expect(isRepeatCapture({ repeat_of: 'x' })).toBe(true);
    expect(isRepeatCapture({})).toBe(false);
    const p: Record<string, unknown> = { page_number: 7, repeat_of: 'a' };
    expect(isVisiblePage(p)).toBe(false);
    delete p.repeat_of;
    expect(isVisiblePage(p)).toBe(true);
  });
});

describe('reader page count without fetching pages (PR #7777 review S1)', () => {
  it('counts every page, then subtracts the repeats, on index-boundable filters', async () => {
    const f = readerPageCountFilters('B');
    expect(f.all).toEqual({ book_id: 'B', page_number: { $gte: 0 } }); // no repeat_of: stays a COUNT_SCAN
    expect(f.repeats).toEqual({ book_id: 'B', repeat_of: { $type: 'string' }, page_number: { $gte: 0 } });
    expect(readerPageCountFilters('B', 't1').repeats).toMatchObject({ tenantId: 't1' });
    const seen: unknown[] = [];
    const n = await countReaderListedPages(async (q) => { seen.push(q); return 'repeat_of' in q ? 7 : 100; }, 'B');
    expect(n).toBe(93);
    expect(seen).toHaveLength(2);
    expect(await countReaderListedPages(async (q) => ('repeat_of' in q ? 5 : 0), 'B')).toBe(0);
  });
});

describe('resolveRepeatKeeper (PR #7777 review S6)', () => {
  const store = (...ps: Record<string, unknown>[]) => {
    const m = new Map(ps.map(p => [p.id as string, p]));
    return async (id: string) => (m.get(id) ?? null) as never;
  };
  it('answers the kept page', async () => {
    expect(await resolveRepeatKeeper(store({ id: 'k', page_number: 4 }), 'k')).toBe('k');
  });
  it('follows a keeper split after the hide to its first leaf', async () => {
    const s = store({ id: 'k', page_number: -4, split_into: ['k-L', 'k-R'] }, { id: 'k-L', page_number: 4 });
    expect(await resolveRepeatKeeper(s, 'k')).toBe('k-L');
  });
  it('follows a chain of repeats', async () => {
    expect(await resolveRepeatKeeper(store({ id: 'a', page_number: 6, repeat_of: 'k' }, { id: 'k', page_number: 4 }), 'a')).toBe('k');
  });
  it('answers null for a missing or soft-hidden keeper, and for a cycle', async () => {
    expect(await resolveRepeatKeeper(store(), 'k')).toBeNull();
    expect(await resolveRepeatKeeper(store({ id: 'k', page_number: -4 }), 'k')).toBeNull();
    expect(await resolveRepeatKeeper(store({ id: 'a', page_number: 6, repeat_of: 'b' }, { id: 'b', page_number: 7, repeat_of: 'a' }), 'a')).toBeNull();
  });
});

describe('repeat-of-orphans audit classes (PR #7777 review S6)', () => {
  const hid = { id: 'h', book_id: 'B', page_number: 9, repeat_of: 'k' };
  it('classifies each way a keeper can leave the list', () => {
    expect(classifyRepeatTarget(hid, { id: 'k', book_id: 'B', page_number: 4 })).toBe('ok');
    expect(classifyRepeatTarget(hid, null)).toBe('missing');
    expect(classifyRepeatTarget(hid, { id: 'k', book_id: 'OTHER', page_number: 4 })).toBe('missing');
    expect(classifyRepeatTarget(hid, { id: 'k', book_id: 'B', page_number: -4 })).toBe('soft-hidden');
    expect(classifyRepeatTarget(hid, { id: 'k', book_id: 'B', page_number: -4, split_into: ['kL', 'kR'] })).toBe('split');
    expect(classifyRepeatTarget(hid, { id: 'k', book_id: 'B', page_number: 4, repeat_of: 'x' })).toBe('chain');
    expect(classifyRepeatTarget({ ...hid, repeat_of: 'h' }, hid)).toBe('self');
    expect(FAILING).not.toContain('split'); // the redirect follows split_into[0]
  });
});

describe('planBookRepeats (#5056)', () => {
  it('keeps the earliest capture when the text is the same', () => {
    const { clusters } = planBookRepeats([{ pageId: 'p7', copyOfId: 'p5', page: 7, copyOf: 5 }], byId(page('p5', 5, 200), page('p7', 7, 205)));
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ verdict: 'hide', keep: 'p5', hide: [{ id: 'p7', page_number: 7 }] });
  });

  it('keeps the later capture when it clearly holds more text (a slip lifted)', () => {
    const { clusters } = planBookRepeats([{ pageId: 'p7', copyOfId: 'p5' }], byId(page('p5', 5, 100), page('p7', 7, 200)));
    expect(clusters[0]).toMatchObject({ verdict: 'hide', keep: 'p7', hide: [{ id: 'p5' }] });
  });

  it('lists a not-clearly-different pair as ambiguous and hides nothing', () => {
    const { clusters } = planBookRepeats([{ pageId: 'p7', copyOfId: 'p5' }], byId(page('p5', 5, 100), page('p7', 7, 118)));
    expect(clusters[0]).toMatchObject({ verdict: 'ambiguous', hide: [] });
  });

  it('a named occlusion with no text winner is ambiguous', () => {
    const slip = { ocr: { data: `${words(100)} <warning>A paper slip covers the lower half.</warning>` } };
    const { clusters } = planBookRepeats([{ pageId: 'p7', copyOfId: 'p5' }], byId(page('p5', 5, 100), page('p7', 7, 100, slip)));
    expect(clusters[0].verdict).toBe('ambiguous');
  });

  it('a slip-like word in the book\'s own text is not an occlusion', () => {
    expect(namesOcclusion('Tenebrae non obscurabuntur a te')).toBe(false);
    expect(namesOcclusion('<note>Marginalia partially obscured by the gutter</note>')).toBe(true);
  });

  it('a leaf shot three times: one cluster, both later captures point straight at the first (no chains)', () => {
    const pairs = [{ pageId: 'p4', copyOfId: 'p2' }, { pageId: 'p6', copyOfId: 'p4' }, { pageId: 'p6', copyOfId: 'p2' }];
    const { clusters } = planBookRepeats(pairs, byId(page('p2', 2, 200), page('p4', 4, 200), page('p6', 6, 200)));
    expect(clusters).toHaveLength(1);
    expect(clusters[0].keep).toBe('p2');
    expect(clusters[0].hide.map((h: { id: string }) => h.id).sort()).toEqual(['p4', 'p6']);
  });

  it('a page joined only through a middle capture is not hidden', () => {
    const pairs = [{ pageId: 'p4', copyOfId: 'p2' }, { pageId: 'p6', copyOfId: 'p4' }];
    const { clusters } = planBookRepeats(pairs, byId(page('p2', 2, 200), page('p4', 4, 200), page('p6', 6, 200)));
    expect(clusters[0]).toMatchObject({ verdict: 'ambiguous', hide: [] });
  });

  it('L, L, R, R: two leaves, two clusters', () => {
    const pairs = [{ pageId: 'p7', copyOfId: 'p5' }, { pageId: 'p8', copyOfId: 'p6' }];
    const { clusters } = planBookRepeats(pairs, byId(page('p5', 5, 200), page('p6', 6, 300), page('p7', 7, 200), page('p8', 8, 300)));
    expect(clusters.map((c: { keep: string }) => c.keep).sort()).toEqual(['p5', 'p6']);
  });

  it('skips soft-hidden and renumbered pages, and a re-run is a no-op', () => {
    const neg = planBookRepeats([{ pageId: 'p7', copyOfId: 'p5' }], byId(page('p5', -5, 200), page('p7', 7, 200)));
    expect(neg.clusters).toHaveLength(0);
    expect(neg.skipped[0].why).toMatch(/soft-hidden/);
    const moved = planBookRepeats([{ pageId: 'p7', copyOfId: 'p5', page: 7, copyOf: 5 }], byId(page('p5', 5, 200), page('p7', 8, 200)));
    expect(moved.skipped[0].why).toMatch(/renumbered/);
    const rerun = planBookRepeats([{ pageId: 'p7', copyOfId: 'p5' }], byId(page('p5', 5, 200), page('p7', 7, 200, { repeat_of: 'p5' })));
    expect(rerun.clusters[0]).toMatchObject({ verdict: 'done', hide: [] });
  });

  it('counts words with the detector\'s tokenizer (tags stripped)', () => {
    expect(wordCount('<page-num>12</page-num> Hermes Trismegistus')).toBe(3);
  });
});

describe('chapter links to a hidden repeat open the kept page (#5056)', () => {
  const pages = byId(
    { id: 'p168', page_number: 168 },
    { id: 'p170', page_number: 170, repeat_of: 'p168' },
    { id: 'p254', page_number: 254, repeat_of: 'p252' },
    { id: 'p252', page_number: 252, repeat_of: 'p250' }, // a chain
    { id: 'p250', page_number: 250 },
    { id: 'orphan', page_number: 300, repeat_of: 'gone' },
    { id: 'p10', page_number: 10 },
  );
  const finder = () => {
    const calls: string[][] = [];
    const find = async (ids: string[]) => { calls.push(ids); return ids.map(id => pages.get(id)).filter(Boolean) as object[]; };
    return { calls, find };
  };

  it('resolveRepeatKeepers maps only repeats with a keeper, in two batched lookups', async () => {
    const { calls, find } = finder();
    const keepers = await resolveRepeatKeepers(find, ['p10', 'p170', 'p254', 'orphan', 'p170', 'missing']);
    expect([...keepers]).toEqual([['p170', 'p168'], ['p254', 'p250']]);
    // 1: the chapter pages; 2: their keepers; then one hop for the chain, one for the orphan's target.
    expect(calls[0]).toEqual(['p10', 'p170', 'p254', 'orphan', 'missing']);
    expect(calls[1].sort()).toEqual(['gone', 'p168', 'p252']);
    expect(calls.length).toBeLessThanOrEqual(4);
  });

  it('no repeats among the ids: one lookup, empty map', async () => {
    const { calls, find } = finder();
    expect((await resolveRepeatKeepers(find, ['p10', 'p168'])).size).toBe(0);
    expect(calls.length).toBe(1);
    expect((await resolveRepeatKeepers(find, [])).size).toBe(0);
    expect(calls.length).toBe(1);
  });

  it('mapChapterPageIds swaps hidden ids, keeps everything else, never mutates', () => {
    const chapters = [
      { title: 'A', pageNumber: 10, pageId: 'p10' },
      { title: 'Des petits garçons', pageNumber: 170, pageId: 'p170' },
      { title: 'No id', pageNumber: 200 },
    ];
    const snapshot = JSON.parse(JSON.stringify(chapters));
    const out = mapChapterPageIds(chapters, new Map([['p170', 'p168']]));
    expect(out.map(c => c.pageId)).toEqual(['p10', 'p168', undefined]);
    expect(out[1]).toMatchObject({ title: 'Des petits garçons', pageNumber: 170 });
    expect(chapters).toEqual(snapshot);
    expect(mapChapterPageIds(chapters, new Map())).toBe(chapters);
    expect(mapChapterPageIds(chapters, new Map([['other', 'x']]))).toBe(chapters);
  });

  it('the chapter number follows the keeper, so the reader marks it current on the page it opens', () => {
    const chapters = [{ title: 'A', pageNumber: 160, pageId: 'p160' }, { title: 'B', pageNumber: 170, pageId: 'p170' }];
    const nums: Record<string, number> = { p160: 160, p168: 168 };
    const out = mapChapterPageIds(chapters, new Map([['p170', 'p168']]), id => nums[id]);
    expect(out[1]).toEqual({ title: 'B', pageNumber: 168, pageId: 'p168' });
    // Unknown keeper number: the id still moves, the stored number stays.
    expect(mapChapterPageIds(chapters, new Map([['p170', 'p168']]), () => undefined)[1].pageNumber).toBe(170);
  });
});

describe('book page: printed-number links skip a hidden repeat (#5056)', () => {
  it('resolvePageIdsByNumber maps a repeat number to its keeper, a shared number to the listed page', async () => {
    const rows = [
      { id: 'p168', page_number: 168 },
      { id: 'p170', page_number: 170, repeat_of: 'p168' },
      { id: 'dupe', page_number: 12, repeat_of: 'p10' },
      { id: 'p12', page_number: 12 },
      { id: 'p10', page_number: 10 },
    ];
    const db = {
      collection: () => ({
        find: (filter: { page_number?: { $in: number[] }; id?: { $in: string[] } }) => ({
          toArray: async () => filter.page_number
            ? rows.filter(r => filter.page_number!.$in.includes(r.page_number))
            : rows.filter(r => filter.id!.$in.includes(r.id)),
        }),
      }),
    };
    const out = await resolvePageIdsByNumber(db as never, 'B', [168, 170, 12]);
    expect(out).toEqual({ 168: 'p168', 170: 'p168', 12: 'p12' });
  });
});
