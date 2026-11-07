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
import { readBphFilters, isUnfiltered, applyBphFilters, parseBphSearchTerms, bphBestMatchTiers, type SchemaCaps } from '../../src/lib/bph-catalog-filters';

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

describe('parseBphSearchTerms', () => {
  it('splits words and drops punctuation, so a name reads either way round', () => {
    expect(parseBphSearchTerms('bruno giordano')).toEqual(['bruno', 'giordano']);
    expect(parseBphSearchTerms('Fludd, Robert')).toEqual(['fludd', 'robert']);
    expect(parseBphSearchTerms('Bhagavad-Gita')).toEqual(['bhagavad', 'gita']);
  });

  it('normalises each word the way search_norm is built', () => {
    expect(parseBphSearchTerms('Böhme Aurora')).toEqual(['bohme', 'aurora']);
  });

  it('keeps a quoted phrase whole, and turns its reserved characters into wildcards', () => {
    expect(parseBphSearchTerms('"aus gott und der natur" 1740')).toEqual(['aus gott und der natur', '1740']);
    expect(parseBphSearchTerms('"Fludd, Robert"')).toEqual(['fludd% robert']);
  });

  it('treats an unclosed quote as ordinary words', () => {
    expect(parseBphSearchTerms('"aus gott')).toEqual(['aus', 'gott']);
  });

  it('keeps shelf marks together, because a lone letter matches nearly everything', () => {
    expect(parseBphSearchTerms('M 309')).toEqual(['m 309']);
    expect(parseBphSearchTerms('PH 2')).toEqual(['ph 2']);
    expect(parseBphSearchTerms('BPH 131')).toEqual(['bph 131']);
    expect(parseBphSearchTerms('Myst Alg S')).toEqual(['myst', 'alg s']);
  });

  // "c.g. jung" found 34 works as a phrase and 1 when split into c, g, jung.
  it('keeps initials as the record prints them', () => {
    expect(parseBphSearchTerms('c.g. jung')).toEqual(['c.g.', 'jung']);
    expect(parseBphSearchTerms('C. G. Jung')).toEqual(['c. g.', 'jung']);
    expect(parseBphSearchTerms('j. dee')).toEqual(['j. dee']);
    expect(parseBphSearchTerms('Fludd. Robert')).toEqual(['fludd', 'robert']);
  });

  it('does not glue a year to a longer word', () => {
    expect(parseBphSearchTerms('hermes 1650')).toEqual(['hermes', '1650']);
  });

  it('keeps words in non-Latin scripts whole, marks included', () => {
    expect(parseBphSearchTerms('भगवद् गीता')).toEqual(['भगवद्', 'गीता']);
    expect(parseBphSearchTerms('Ψυχή σώμα')).toEqual(['ψυχη', 'σωμα']);
  });

  it('finds no terms in punctuation alone', () => {
    expect(parseBphSearchTerms(', ()')).toEqual([]);
  });
});

describe('bphBestMatchTiers', () => {
  it('files works by the name, then titled with it, then the rest, with no overlap', () => {
    const byAuthor = 'and(author_norm.ilike.%marsilio%,author_norm.ilike.%ficino%)';
    const inTitle = 'and(title_norm.ilike.%marsilio%,title_norm.ilike.%ficino%)';
    expect(bphBestMatchTiers(parse('q=marsilio+ficino&sort=relevance'), NEW_SCHEMA)).toEqual([
      [byAuthor],
      [inTitle, `not.${byAuthor}`],
      [`not.${byAuthor}`, `not.${inTitle}`],
    ]);
  });

  it('does not apply to another sort, an empty search, or a schema without *_norm columns', () => {
    expect(bphBestMatchTiers(parse('q=ficino&sort=author'), NEW_SCHEMA)).toBeNull();
    expect(bphBestMatchTiers(parse('sort=relevance'), NEW_SCHEMA)).toBeNull();
    expect(bphBestMatchTiers(parse('q=ficino&sort=relevance'), { ...NEW_SCHEMA, hasNormalizedColumns: false })).toBeNull();
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

  it('requires every word, in any order, and keeps the shelf-mark lane', () => {
    const { q, calls } = recorder();
    applyBphFilters(q as never, parse('q=bruno+giordano'), NEW_SCHEMA);
    const orCall = calls.find((c) => c.startsWith('or('))!;
    expect(orCall).toContain('and(search_norm.ilike.%bruno%,search_norm.ilike.%giordano%)');
    expect(orCall).toContain('ubn.ilike.%bruno giordano%');
  });

  it('lets a year among the words match the year column', () => {
    const { q, calls } = recorder();
    applyBphFilters(q as never, parse('q=hermes+1650'), NEW_SCHEMA);
    expect(calls.find((c) => c.startsWith('or('))).toContain('or(search_norm.ilike.%1650%,year.eq.1650)');
  });

  it('ignores a one-character query rather than scanning the corpus', () => {
    const { q, calls } = recorder();
    applyBphFilters(q as never, parse('q=B'), NEW_SCHEMA);
    expect(calls.filter((c) => c.startsWith('or(') || c.startsWith('textSearch('))).toHaveLength(0);
  });

  // The catalogue files every author this way. With the comma stripped,
  // "Steiner, Rudolf" found 1 work and "Steiner" found 599.
  it('keeps the comma in an author filter, as the catalogue files names', () => {
    const { q, calls } = recorder();
    applyBphFilters(q as never, parse('author=Steiner%2C+Rudolf'), NEW_SCHEMA);
    expect(calls).toContain('ilike("author_norm","%steiner, rudolf%")');
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

  // 199 of the first 200 rows in Author A–Z began with a bracket (2026-11-06).
  it('files by the sort columns, which ignore leading brackets', () => {
    const { q, calls } = recorder();
    applyBphFilters(q as never, parse('sort=author'), NEW_SCHEMA);
    expect(calls.slice(-3).map((c) => c.split(',')[0])).toEqual([
      'order("author_sort"', 'order("title_sort"', 'order("uuid"',
    ]);
  });

  it('keeps the raw columns on the legacy schema, which has no sort columns', () => {
    const { q, calls } = recorder();
    applyBphFilters(q as never, parse('sort=author'), { mode: 'legacy', hasNormalizedColumns: false, hasFirstTranslationColumn: false });
    expect(calls.some((c) => c.startsWith('order("author"'))).toBe(true);
  });

  it('orders Best match by author within its tiers', () => {
    const { q, calls } = recorder();
    applyBphFilters(q as never, parse('q=ficino&sort=relevance'), NEW_SCHEMA);
    expect(calls.some((c) => c.startsWith('order("author_sort"'))).toBe(true);
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
