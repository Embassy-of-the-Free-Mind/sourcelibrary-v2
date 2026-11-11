import { describe, it, expect } from 'vitest';
import { foldLatin, locateInOriginal, locateQuery } from '@/lib/search/original-snippet';

// #7175: on /la a reader types modern spelling and the page prints early modern
// spelling. The fold finds the place; the excerpt keeps the page's letters.

const at = (text: string, span: [number, number] | null) => (span ? text.slice(span[0], span[1]) : null);

describe('foldLatin', () => {
  it('folds case, u/v, i/j, long s, ae/oe ligatures and accents, keeping a map to the original', () => {
    const { folded, map } = foldLatin('Vniverſum æther Iuſtitia quàm');
    expect(folded).toBe('uniuersum aether iustitia quam');
    // `æ` (one character) folds to two, both mapped back to it.
    expect(map[folded.indexOf('aether')]).toBe(map[folded.indexOf('aether') + 1]);
  });
});

describe('locateInOriginal', () => {
  it('finds a modern spelling in an early modern page and returns the printed form', () => {
    const page = 'Deus creavit vniuerſum ex nihilo.';
    expect(at(page, locateInOriginal(page, 'universum', { latin: true }))).toBe('vniuerſum');
  });

  it('control: without the Latin fold the same query is not found', () => {
    const page = 'Deus creavit vniuerſum ex nihilo.';
    expect(locateInOriginal(page, 'universum', { latin: false })).toBeNull();
  });

  it('folds ae against the ligature', () => {
    const page = 'In cælo et in terra.';
    expect(at(page, locateInOriginal(page, 'caelo', { latin: true }))).toBe('cælo');
  });

  it('prefers a whole word over a hit inside a longer word', () => {
    const page = 'philosophorumque lapis philosophorum';
    const span = locateInOriginal(page, 'philosophorum', { latin: true })!;
    expect(span[0]).toBe(page.lastIndexOf('philosophorum'));
  });

  it('finds a Chinese query in unspaced text', () => {
    const page = '夫陰陽者，天地之道也。';
    expect(at(page, locateInOriginal(page, '陰陽', { latin: false }))).toBe('陰陽');
  });
});

describe('locateQuery', () => {
  it('tries the whole phrase, then its words longest first', () => {
    const page = 'Hic de lapide dicitur, et de philoſophorum arte.';
    expect(at(page, locateQuery(page, 'lapis philosophorum', { latin: true }))).toBe('philoſophorum');
  });

  it('falls back to the engine-reported hit', () => {
    const page = 'Mercurius noster est aqua.';
    expect(at(page, locateQuery(page, 'argentum vivum', { latin: true, hit: 'Mercurius' }))).toBe('Mercurius');
  });

  it('returns null when nothing is there', () => {
    expect(locateQuery('Nihil hic.', 'sulphur', { latin: true })).toBeNull();
  });
});
