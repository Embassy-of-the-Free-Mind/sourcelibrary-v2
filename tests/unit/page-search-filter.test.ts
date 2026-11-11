import { describe, it, expect } from 'vitest';
import { buildPageSearchStage, PHRASE_FIRST_BOOST } from '@/lib/atlas-search';

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

// #6877: an unquoted Han or Tibetan run is one token per character or syllable, so the `text` clause
// alone matches any page printing any one of them. The phrase clauses put the page printing the run first.
describe('buildPageSearchStage phrase-first for unspaced scripts', () => {
  const should = (q: string) => (buildPageSearchStage(q) as any).$search.compound.should as any[];

  it.each(['司射遂適階', 'བུཾ་པ་དབང་ཙག', 'ひらがなの文'])('an unquoted %s scores as a phrase AND as any token', (q) => {
    const s = should(q);
    expect(s.filter(c => c.phrase)).toEqual([
      { phrase: { query: q, path: 'translation.data', score: { boost: { value: 2 * PHRASE_FIRST_BOOST } } } },
      { phrase: { query: q, path: 'ocr.data', score: { boost: { value: PHRASE_FIRST_BOOST } } } },
    ]);
    expect(s.filter(c => c.text).map(c => c.text.path)).toEqual(['translation.data', 'ocr.data']);
  });

  it('a 6+ character Han run is not fuzzy', () => {
    expect(should('大射之禮司射').some(c => c.text?.fuzzy)).toBe(false);
  });

  it('spaced scripts are unchanged: no phrase clause, one long word still fuzzy', () => {
    expect(should('philosophers stone').some(c => c.phrase)).toBe(false);
    expect(should('alchemical').every(c => c.text?.fuzzy)).toBe(true);
  });

  it('a quoted run stays a plain phrase', () => {
    expect(should('"司射遂適階"')).toEqual([
      { phrase: { query: '司射遂適階', path: 'translation.data', score: { boost: { value: 2 } } } },
      { phrase: { query: '司射遂適階', path: 'ocr.data' } },
    ]);
  });

  it('name-variant lane keeps the phrase clauses among the scoring ones', () => {
    const st = (buildPageSearchStage('老子 道', undefined, { nameVariants: ['Laozi'], requireNameVariant: true }) as any).$search.compound;
    expect(st.should.filter((c: any) => c.phrase)).toHaveLength(2);
    expect(st.must[0].compound.should.every((c: any) => c.text.query[0] === 'Laozi')).toBe(true);
  });
});
