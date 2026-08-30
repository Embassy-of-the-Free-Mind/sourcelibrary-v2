/**
 * The BPH catalogue search predicate is shared by two surfaces — the browsing
 * API and the CSV export — because an export that matches a different set than
 * the screen it was launched from is worse than no export: nothing reveals the
 * drift. These tests pin the parsing and the predicate SHAPE, so a change to
 * one surface cannot quietly become a change to only one surface.
 *
 * Behaviour equivalence with the pre-refactor route was established by running
 * 23 queries against production and localhost and comparing total + ordered
 * results (23/23 identical, 2026-08-13). These tests guard it going forward.
 *
 * Requested by José Bouman (BPH), 2026-08-12: "Is it possible to export a
 * search selection? I would like to have all books which have JRR in one of
 * the fields.... This is an important feature, that we often! use!"
 */
import { describe, it, expect } from 'vitest';
import { readBphFilters, isUnfiltered, applyBphFilters, type SchemaCaps } from '../../src/lib/bph-catalog-filters';

/** Records every builder call so the predicate can be asserted on. */
function recorder() {
  const calls: string[] = [];
  const q: Record<string, (...a: unknown[]) => unknown> = {};
  for (const m of ['or', 'eq', 'is', 'not', 'gte', 'lte', 'ilike', 'textSearch', 'order']) {
    q[m] = (...args: unknown[]) => {
      calls.push(`${m}(${args.map((a) => JSON.stringify(a)).join(',')})`);
      return q;
    };
  }
  return { q, calls };
}

const NEW_SCHEMA: SchemaCaps = { mode: 'new', hasNormalizedColumns: true, hasFirstTranslationColumn: true };

const parse = (qs: string) => readBphFilters(new URLSearchParams(qs));

describe('readBphFilters', () => {
  it('reads every filter the browsing UI can set', () => {
    const f = parse('q=JRR&author=Fludd&title=alchimia&place=Amsterdam&printer=Blaeu&publisher=Elzevier'
      + '&editor=Casaubon&keyword=alchemy&language=Latin&shelf_mark=M+3&provenance=Ritman'
      + '&yearFrom=1600&yearTo=1650&digitized=sl&first_translation=1&sort=year_asc');
    expect(f).toEqual({
      q: 'JRR', author: 'Fludd', title: 'alchimia', place: 'Amsterdam', printer: 'Blaeu',
      publisher: 'Elzevier', editor: 'Casaubon', keyword: 'alchemy', language: 'Latin',
      shelfMark: 'M 3', provenance: 'Ritman', yearFrom: 1600, yearTo: 1650,
      digitized: 'sl', firstTranslation: true, sort: 'year_asc',
    });
  });

  it('trims, and defaults sort to title', () => {
    const f = parse('q=%20%20Bohme%20%20');
    expect(f.q).toBe('Bohme');
    expect(f.sort).toBe('title');
  });

  it('leaves absent years null rather than NaN', () => {
    expect(parse('').yearFrom).toBeNull();
    expect(parse('').yearTo).toBeNull();
  });
});

describe('isUnfiltered', () => {
  it('is true only when nothing narrows the set', () => {
    expect(isUnfiltered(parse(''))).toBe(true);
    // The digitised lane is a view, not a filter — it drives the pinned count.
    expect(isUnfiltered(parse('digitized=sl'))).toBe(true);
    expect(isUnfiltered(parse('sort=year_asc'))).toBe(true);
  });

  it('is false as soon as any real filter is set', () => {
    for (const qs of ['q=JRR', 'author=Fludd', 'yearFrom=1600', 'first_translation=1', 'keyword=alchemy']) {
      expect(isUnfiltered(parse(qs)), qs).toBe(false);
    }
  });
});

describe('applyBphFilters — the lanes that were reported as broken', () => {
  it('matches a UBN exactly for an all-digit query, never as a substring', () => {
    // José Bouman: searching a UBN returned nothing. A substring lane would
    // make "1545" also drag in 15450–15459, 11545, 21545…
    const { q, calls } = recorder();
    applyBphFilters(q as never, parse('q=1545'), NEW_SCHEMA);
    const orCall = calls.find((c) => c.startsWith('or('))!;
    expect(orCall).toContain('ubn.eq.1545');
    expect(orCall).not.toContain('ubn.ilike');
  });

  it('also matches the year column for a bare 3–4 digit query', () => {
    const { q, calls } = recorder();
    applyBphFilters(q as never, parse('q=1545'), NEW_SCHEMA);
    expect(calls.find((c) => c.startsWith('or('))).toContain('year.eq.1545');
  });

  it('falls back to a substring lane for a non-numeric UBN like "BPH 131"', () => {
    const { q, calls } = recorder();
    applyBphFilters(q as never, parse('q=BPH+131'), NEW_SCHEMA);
    expect(calls.find((c) => c.startsWith('or('))).toContain('ubn.ilike');
  });

  it('searches the diacritic-normalised column so "Bohme" finds "Böhme"', () => {
    const { q, calls } = recorder();
    applyBphFilters(q as never, parse('q=Bohme'), NEW_SCHEMA);
    expect(calls.find((c) => c.startsWith('or('))).toContain('search_norm.ilike');
  });

  it('ignores a one-character query rather than scanning the corpus', () => {
    const { q, calls } = recorder();
    applyBphFilters(q as never, parse('q=B'), NEW_SCHEMA);
    expect(calls.filter((c) => c.startsWith('or(') || c.startsWith('textSearch('))).toHaveLength(0);
  });

  it('rolls an author search up with its variants via the _norm column', () => {
    const { q, calls } = recorder();
    applyBphFilters(q as never, parse('author=Fludd'), NEW_SCHEMA);
    expect(calls).toContain('ilike("author_norm","%fludd%")');
  });

  it('uses shelf_mark_norm, not shelf_mark_norm-by-convention', () => {
    const { q, calls } = recorder();
    applyBphFilters(q as never, parse('shelf_mark=M+3'), NEW_SCHEMA);
    expect(calls.some((c) => c.startsWith('ilike("shelf_mark_norm"'))).toBe(true);
  });

  it('returns nothing for a first-translation filter the schema cannot answer', () => {
    const { q, calls } = recorder();
    applyBphFilters(q as never, parse('first_translation=1'), { ...NEW_SCHEMA, hasFirstTranslationColumn: false });
    expect(calls).toContain('eq("sl_book_id","__no_first_translations__")');
  });

  it('always orders, so a paged export walks the same sequence as the screen', () => {
    for (const sort of ['title', 'title_desc', 'year_asc', 'year_desc', 'author', 'author_desc', 'shelfmark']) {
      const { q, calls } = recorder();
      applyBphFilters(q as never, parse(`sort=${sort}`), NEW_SCHEMA);
      expect(calls.some((c) => c.startsWith('order(')), sort).toBe(true);
    }
  });

  it('never orders nulls first — null titles must not lead any listing', () => {
    for (const sort of ['title_desc', 'year_asc', 'year_desc', 'author', 'author_desc', 'shelfmark']) {
      const { q, calls } = recorder();
      applyBphFilters(q as never, parse(`sort=${sort}`), NEW_SCHEMA);
      for (const c of calls.filter((c) => c.startsWith('order('))) {
        expect(c.includes('"nullsFirst":true'), `${sort}: ${c}`).toBe(false);
      }
    }
  });

  it('drops language and provenance on the legacy schema instead of erroring', () => {
    const { q, calls } = recorder();
    applyBphFilters(q as never, parse('language=Latin&provenance=Ritman'), {
      mode: 'legacy', hasNormalizedColumns: false, hasFirstTranslationColumn: false,
    });
    expect(calls.some((c) => c.includes('language'))).toBe(false);
    expect(calls.some((c) => c.includes('provenance'))).toBe(false);
  });
});
