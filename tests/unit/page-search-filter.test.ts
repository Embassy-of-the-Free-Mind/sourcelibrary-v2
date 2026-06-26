import { describe, it, expect } from 'vitest';
import { buildPageSearchStage } from '@/lib/atlas-search';

// Guards the language-filter fail-open fixed in #2760. When a book-level filter
// (e.g. a language with zero matching titles) resolves to an EMPTY allow-list,
// page search must return zero results — it must never fall back to scanning
// the whole corpus. `buildPageSearchStage` is the shared Atlas stage builder;
// the distinction is: `undefined` bookIds = no book filter, but an empty array
// = a computed allow-list that matched nothing.

type Filter = { equals?: { path: string; value: string }; in?: { path: string; value: string[] }; range?: unknown };

function filtersOf(stage: any): Filter[] {
  return stage.$search.compound.filter as Filter[];
}

describe('buildPageSearchStage book_id filter', () => {
  it('applies no book filter when bookIds is undefined', () => {
    const filters = filtersOf(buildPageSearchStage('mercury'));
    expect(filters.some(f => f.equals?.path === 'book_id' || f.in?.path === 'book_id')).toBe(false);
  });

  it('filters to a single book for a string bookId', () => {
    const filters = filtersOf(buildPageSearchStage('mercury', 'book-123'));
    expect(filters).toContainEqual({ equals: { path: 'book_id', value: 'book-123' } });
  });

  it('filters to the allow-list for a non-empty array', () => {
    const filters = filtersOf(buildPageSearchStage('mercury', ['a', 'b']));
    expect(filters).toContainEqual({ in: { path: 'book_id', value: ['a', 'b'] } });
  });

  it('matches NOTHING for an empty allow-list — must not fail open (#2760)', () => {
    const filters = filtersOf(buildPageSearchStage('mercury', []));
    // An impossible book_id sentinel guarantees zero matches.
    const bookFilter = filters.find(f => f.equals?.path === 'book_id' || f.in?.path === 'book_id');
    expect(bookFilter).toBeDefined();
    // It must NOT be an `in` over an empty array (Atlas rejects it / undefined behavior),
    // and must NOT be absent (which would scan the whole corpus).
    expect(bookFilter?.in).toBeUndefined();
    expect(bookFilter?.equals?.path).toBe('book_id');
    expect(bookFilter?.equals?.value).not.toBe('');
  });
});
