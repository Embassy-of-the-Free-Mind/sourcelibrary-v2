import { describe, it, expect } from 'vitest';
import {
  resolveReadingList,
  readingListBookIds,
  READING_LIST_MATCH_LABEL,
  type ReadingListItem,
} from '@/lib/reading-list';
import type { FurtherReadingBook } from '@/lib/further-reading';

const book = (id: string, extra: Partial<FurtherReadingBook> = {}): FurtherReadingBook => ({
  id, slug: `slug-${id}`, title: `Book ${id}`,
  pages_count: 100, pages_ocr: 100, pages_translated: 0, pages_blank: 0,
  ...extra,
});

const A = book('a');
const B = book('b');
const C = book('c', { pages_translated: 100 });

const ITEMS: ReadingListItem[] = [
  { n: 'N01', work: 'Burchard, Corrector', wanted: 'Clm 4570', held: [{ book_id: 'a', match: 'exact', witness: 'BSB Clm 4570' }] },
  { n: 'N02', work: 'Bartholomew of Exeter', wanted: 'BL Cotton Vitellius A.XII', held: [], note: 'BL IIIF down.' },
  { n: 'N03', work: 'Alain de Lille', held: [{ book_id: 'c', match: 'fallback' }, { book_id: 'b', match: 'stopgap', witness: '1518 print' }] },
];

describe('resolveReadingList', () => {
  it("preserves the curator's order of rows and of witnesses within a row", () => {
    const rows = resolveReadingList(ITEMS, [B, A, C]);
    expect(rows.map(r => r.n)).toEqual(['N01', 'N02', 'N03']);
    expect(rows[2].witnesses.map(w => w.book_id)).toEqual(['c', 'b']);
  });

  it('accepts the document form as well as a bare array', () => {
    const rows = resolveReadingList({ source: 'list', items: ITEMS }, [A, B, C]);
    expect(rows).toHaveLength(3);
  });

  /**
   * The loader fetches with `visible: true`. A ref whose book did not come
   * back is dropped WITH its authored witness label: that label names a
   * specific book, and an authored id list is a takedown surface.
   */
  it('drops a ref whose book was not returned, label included', () => {
    const rows = resolveReadingList(ITEMS, [A, C]); // b hidden
    const n03 = rows[2];
    expect(n03.state).toBe('held');
    expect(n03.witnesses.map(w => w.book_id)).toEqual(['c']);
    expect(JSON.stringify(n03)).not.toContain('1518 print');
  });

  it('marks a row whose refs ALL failed to resolve as preparing — no titles, no witnesses', () => {
    const rows = resolveReadingList(ITEMS, [C]); // a hidden
    expect(rows[0].state).toBe('preparing');
    expect(rows[0].witnesses).toEqual([]);
    expect(JSON.stringify(rows[0])).not.toContain('BSB Clm 4570');
  });

  it('marks a row with no held refs as a gap and keeps its note', () => {
    const rows = resolveReadingList(ITEMS, [A, B, C]);
    expect(rows[1].state).toBe('gap');
    expect(rows[1].note).toBe('BL IIIF down.');
  });

  it('carries match and a readability status onto each witness', () => {
    const rows = resolveReadingList(ITEMS, [A, B, C]);
    const [c, b] = rows[2].witnesses;
    expect(c.match).toBe('fallback');
    expect(c.status.kind).toBe('translated');
    expect(b.status.kind).toBe('untranslated');
    expect(READING_LIST_MATCH_LABEL[c.match]).toBe('the list’s fallback');
  });

  it('skips malformed rows and malformed refs instead of throwing', () => {
    const rows = resolveReadingList([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { work: '' } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      null as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { work: 'Valid', held: [{ book_id: 'a', match: 'nonsense' }, { match: 'exact' }, { book_id: 'c', match: 'exact' }] } as any,
    ], [A, C]);
    expect(rows).toHaveLength(1);
    expect(rows[0].witnesses.map(w => w.book_id)).toEqual(['c']);
  });

  it('returns nothing for an absent or empty field', () => {
    expect(resolveReadingList(undefined, [A])).toEqual([]);
    expect(resolveReadingList(null, [A])).toEqual([]);
    expect(resolveReadingList([], [A])).toEqual([]);
    expect(resolveReadingList({ items: [] }, [A])).toEqual([]);
  });
});

describe('readingListBookIds', () => {
  it('collects every well-formed held ref once', () => {
    const ids = readingListBookIds({ items: [...ITEMS, { work: 'dup', held: [{ book_id: 'a', match: 'edition' }] }] });
    expect(ids.sort()).toEqual(['a', 'b', 'c']);
  });

  it('ignores malformed refs and absent documents', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(readingListBookIds({ items: [{ work: 'x', held: [{ match: 'exact' }] } as any] })).toEqual([]);
    expect(readingListBookIds(undefined)).toEqual([]);
  });
});
