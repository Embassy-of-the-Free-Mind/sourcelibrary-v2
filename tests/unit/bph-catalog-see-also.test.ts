import { describe, it, expect } from 'vitest';
import { bphSeeAlsoQueries } from '../../src/lib/bph-catalog-see-also';

describe('bphSeeAlsoQueries', () => {
  it('offers the other spellings of a listed word', () => {
    expect(bphSeeAlsoQueries('jakob')).toEqual(['Jacob']);
    expect(bphSeeAlsoQueries('alchimie')).toEqual(['alchemy', 'alchemie', 'alchimia']);
  });

  it('swaps only the listed word and keeps the rest of the search as typed', () => {
    expect(bphSeeAlsoQueries('die alchimie 1650')).toContain('die alchemy 1650');
  });

  it('matches by normalised form, so Boehme is Böhme as it is in the search', () => {
    expect(bphSeeAlsoQueries('Boehme aurora')).toEqual(['Behmen aurora']);
    expect(bphSeeAlsoQueries('Behmen')).toEqual(['Böhme']);
  });

  it('caps the line when several words are listed', () => {
    expect(bphSeeAlsoQueries('alchimie magia Jakob').length).toBe(4);
  });

  it('asks for nothing when no word is listed, so an ordinary search costs no request', () => {
    expect(bphSeeAlsoQueries('Pythagoras')).toEqual([]);
    expect(bphSeeAlsoQueries('')).toEqual([]);
  });
});
