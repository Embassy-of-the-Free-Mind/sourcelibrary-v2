import { describe, it, expect } from 'vitest';
import { authorSearchTerms, matchingAuthorHeadings } from '../../src/lib/bph-catalog-author-headings';

const headings = (values: Array<string | null>, query: string) =>
  matchingAuthorHeadings(values, authorSearchTerms(query));

describe('matchingAuthorHeadings', () => {
  it('finds the filed heading from a name in natural order', () => {
    expect(headings(['Steiner, Rudolf', 'Steiner, Rudolf', 'Adams, George'], 'rudolf steiner')).toEqual(['Steiner, Rudolf']);
  });

  it('reads each name in a value joined by a pipe', () => {
    expect(headings(['Andreae, Johann Valentin|Steiner, Rudolf', 'Steiner, Rudolf'], 'steiner')).toEqual(['Steiner, Rudolf']);
  });

  it('counts spellings that normalise alike as one heading, in the commonest form', () => {
    const values = ['Boehme, Jacob', 'Boehme, Jacob', 'Böhme, Jacob', 'Boehme, jacob'];
    expect(headings(values, 'böhme')).toEqual(['Boehme, Jacob']);
  });

  it('ignores cataloguers\' brackets and question marks', () => {
    expect(headings(['Fludd, Robert?', '[Fludd, Robert]', 'Fludd, Robert'], 'fludd')).toEqual(['Fludd, Robert']);
  });

  it('matches whole words, so a half-typed word offers no one', () => {
    expect(headings(['Paracelsus, Theophrastus', 'Paracelsus, Theophrastus'], 'the')).toEqual([]);
  });

  it('needs at least two works', () => {
    expect(headings(['Crowley, Aleister', 'Crowley, Gary'], 'crowley')).toEqual([]);
  });

  it('puts the largest first and stops at three', () => {
    const values = [
      ...Array(5).fill('Jung, Carl Gustav'),
      ...Array(4).fill('Jung, Emma'),
      ...Array(3).fill('Jung-Stilling, Johann Heinrich'),
      ...Array(2).fill('Jung, Martin H'),
    ];
    expect(headings(values, 'jung')).toEqual(['Jung, Carl Gustav', 'Jung, Emma', 'Jung-Stilling, Johann Heinrich']);
  });

  it('offers nothing without a usable term or an author value', () => {
    expect(headings(['Dee, John', 'Dee, John'], 'de')).toEqual([]);
    expect(headings([null, ''], 'fludd')).toEqual([]);
  });
});
