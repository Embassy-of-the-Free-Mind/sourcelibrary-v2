import { describe, it, expect } from 'vitest';
import { buildPageSearchStage } from '@/lib/atlas-search';

// Guards the residual language-filter fail-open (#2760). The page lane computes
// a book-ID allow-list; when a filter (e.g. a zero-match language) resolves it
// to an EMPTY array, page search must return nothing — never fall back to the
// whole corpus. The earlier route fix applied `$in: []` unconditionally, but an
// empty array does NOT survive `buildPageSearchStage` unless it emits a
// match-nothing sentinel: `undefined` = no book filter, empty array = an
// allow-list that matched nothing.

type Filter = { equals?: { path: string; value: string }; in?: { path: string; value: string[] } };
const filtersOf = (stage: any): Filter[] => stage.$search.compound.filter as Filter[];

describe('buildPageSearchStage book_id filter', () => {
  it('applies no book filter when bookIds is undefined', () => {
    const filters = filtersOf(buildPageSearchStage('mercury'));
    expect(filters.some(f => f.equals?.path === 'book_id' || f.in?.path === 'book_id')).toBe(false);
  });

  it('filters to a single book for a string bookId', () => {
    expect(filtersOf(buildPageSearchStage('mercury', 'book-123')))
      .toContainEqual({ equals: { path: 'book_id', value: 'book-123' } });
  });

  it('filters to the allow-list for a non-empty array', () => {
    expect(filtersOf(buildPageSearchStage('mercury', ['a', 'b'])))
      .toContainEqual({ in: { path: 'book_id', value: ['a', 'b'] } });
  });

  it('matches NOTHING for an empty allow-list — must not fail open (#2760)', () => {
    const filters = filtersOf(buildPageSearchStage('mercury', []));
    const bookFilter = filters.find(f => f.equals?.path === 'book_id' || f.in?.path === 'book_id');
    expect(bookFilter).toBeDefined();          // not absent (whole-corpus leak)
    expect(bookFilter?.in).toBeUndefined();    // not an empty `$in`
    expect(bookFilter?.equals?.path).toBe('book_id');
    expect(bookFilter?.equals?.value).not.toBe('');
  });
});
