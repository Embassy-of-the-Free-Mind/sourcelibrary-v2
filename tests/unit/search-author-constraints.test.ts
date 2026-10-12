import { describe, it, expect } from 'vitest';
import { applyAuthorConstraints, authorMatches, foldName, hasAuthorConstraints, parseAuthorConstraints } from '@/lib/search/author-constraints';
import type { BookFacets } from '@/lib/search/diversity';

// Hard author / work constraints on the passage tools (#3895): the "25 quotes on
// magia from 25 authors" survey, where seven printings of De occulta philosophia
// swamped the list.

type Row = { book_id: string; author: string | null };
const r = (book_id: string, author: string | null): Row => ({ book_id, author });
const opts = (facets?: Map<string, BookFacets>) => ({ bookId: (x: Row) => x.book_id, author: (x: Row) => x.author, facets });
const ids = (rows: Row[]) => rows.map((x) => x.book_id);

const AGRIPPA = 'Agrippa von Nettesheim, Heinrich Cornelius';
const rows: Row[] = [
  r('agr1', AGRIPPA), r('agr2', AGRIPPA), r('porta1', 'Porta, Giambattista della'),
  r('agr3', 'Agrippa, H. C.'), r('ficino', 'Marsilio Ficino'), r('porta2', 'Giambattista della Porta'),
  r('anon', 'Anonymous'), r('blank', null), r('sadi', 'Saʻdī'),
];

describe('foldName / authorMatches', () => {
  it('keeps every script and elides in-word marks', () => {
    expect(foldName('Saʻdī')).toEqual(['sadi']);
    expect(foldName('薛己')).toEqual(['薛己']);
    expect(foldName('Ibn al-ʿArabī')).toEqual(['ibn', 'al', 'arabi']);
  });
  it('matches by word prefix, not substring', () => {
    expect(authorMatches(AGRIPPA, foldName('agrippa'))).toBe(true);
    expect(authorMatches('Porta, Giambattista della', foldName('della Porta'))).toBe(true);
    expect(authorMatches('Johann Valentin Andreae', foldName('de'))).toBe(false);
    expect(authorMatches('薛己', foldName('薛己'))).toBe(true);
    expect(authorMatches(null, foldName('agrippa'))).toBe(false);
  });
});

describe('parseAuthorConstraints', () => {
  it('accepts a string or an array and only positive caps', () => {
    expect(parseAuthorConstraints({ author: 'Ficino', exclude_authors: ['Agrippa', ' '], max_per_author: '1', max_per_work: 0 }))
      .toEqual({ author: ['Ficino'], exclude_authors: ['Agrippa'], max_per_author: 1, max_per_work: undefined });
    expect(hasAuthorConstraints(parseAuthorConstraints({}))).toBe(false);
  });
});

describe('applyAuthorConstraints', () => {
  it('exclude_authors drops one author and keeps order', () => {
    const { rows: out, report } = applyAuthorConstraints(rows, { exclude_authors: ['Agrippa'] }, opts());
    expect(ids(out)).toEqual(['porta1', 'ficino', 'porta2', 'anon', 'blank', 'sadi']);
    expect(report.excluded).toBe(3);
  });

  it('author keeps only the named authors', () => {
    const { rows: out, report } = applyAuthorConstraints(rows, { author: ['della porta', 'Saʿdi'] }, opts());
    expect(ids(out)).toEqual(['porta1', 'porta2', 'sadi']);
    expect(report.not_matching_author).toBe(6);
  });

  it('max_per_author keeps the best row per author, by author_id when the book has one', () => {
    const facets = new Map<string, BookFacets>([
      ['agr1', { author_id: 'a-agrippa' }], ['agr2', { author_id: 'a-agrippa' }], ['agr3', { author_id: 'a-agrippa' }],
    ]);
    const { rows: out, report } = applyAuthorConstraints(rows, { max_per_author: 1 }, opts(facets));
    // agr3's name differs ("Agrippa, H. C.") but its author_id does not; the two
    // spellings of della Porta fold to the same tokens in a different order, so
    // without an author_id they stay apart (counted as two names).
    expect(ids(out)).toEqual(['agr1', 'porta1', 'ficino', 'porta2', 'anon', 'blank', 'sadi']);
    expect(report.capped_by_author).toBe(2);
    expect(report.rows_without_author).toBe(2); // Anonymous, and the blank author: never capped
  });

  it('max_per_work collapses printings of one work', () => {
    const facets = new Map<string, BookFacets>([
      ['agr1', { work_id: 'w-dop' }], ['agr2', { work_id: 'w-dop' }], ['agr3', { work_id: 'w-dop' }],
      ['porta1', { work_id: 'w-magnat' }], ['porta2', { work_id: 'w-magnat' }],
    ]);
    const { rows: out, report } = applyAuthorConstraints(rows, { max_per_work: 1 }, opts(facets));
    expect(ids(out)).toEqual(['agr1', 'porta1', 'ficino', 'anon', 'blank', 'sadi']);
    expect(report.capped_by_work).toBe(3);
  });

  it('a row one cap drops does not use up the other cap', () => {
    const facets = new Map<string, BookFacets>([
      ['x1', { author_id: 'a', work_id: 'w1' }], ['x2', { author_id: 'a', work_id: 'w1' }], ['x3', { author_id: 'a', work_id: 'w2' }],
    ]);
    const { rows: out } = applyAuthorConstraints([r('x1', 'A'), r('x2', 'A'), r('x3', 'A')], { max_per_author: 2, max_per_work: 1 }, opts(facets));
    expect(ids(out)).toEqual(['x1', 'x3']);
  });

  it('a term with nothing to match on is ignored and reported, never read as "matches nothing"', () => {
    const { rows: out, report } = applyAuthorConstraints(rows, { author: ['—'] }, opts());
    expect(out).toHaveLength(rows.length);
    expect(report.unusable_terms).toEqual(['—']);
  });
});
