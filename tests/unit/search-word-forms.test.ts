import { describe, it, expect } from 'vitest';
import { matchStem, keywordVariants, stemmedQueryRegex } from '@/lib/search/word-forms';

// #5517: "botanical" found nothing while 89 books are keyed "botany". The
// keyword lanes match raw substrings, so related forms must share a stem.
describe('matchStem', () => {
  it('folds adjective and noun to the same stem', () => {
    const pairs: [string, string][] = [
      ['botanical', 'botany'],
      ['alchemical', 'alchemy'],
      ['astrological', 'astrology'],
      ['philosophical', 'philosophy'],
      ['mysticism', 'mystic'],
      ['historical', 'history'],
    ];
    for (const [a, b] of pairs) expect(matchStem(a)).toBe(matchStem(b));
  });

  it('returns a prefix of the word, so a substring match only widens', () => {
    for (const w of ['botanical', 'Hermetic', 'astronomy', 'roses', 'kabbalistic']) {
      expect(w.toLowerCase().startsWith(matchStem(w))).toBe(true);
    }
  });

  it('leaves short words, names and non-Latin text alone', () => {
    expect(matchStem('magic')).toBe('magic');
    expect(matchStem('music')).toBe('music');
    expect(matchStem('Paracelsus')).toBe('paracelsus');
    expect(matchStem('corpus')).toBe('corpus');
    expect(matchStem('genesis')).toBe('genesis');
    expect(matchStem('glass')).toBe('glass');
    expect(matchStem('Ἑρμῆς')).toBe('ἑρμῆς');
    expect(matchStem('arts')).toBe('arts');
  });

  it('strips plain plurals down to four letters', () => {
    expect(matchStem('roses')).toBe('rose');
    expect(matchStem('physics')).toBe('physic');
  });
});

describe('keywordVariants', () => {
  it('reaches the noun keyword from the adjective, in both casings', () => {
    const v = keywordVariants('botanical');
    expect(v).toContain('botany');
    expect(v).toContain('Botany');
    expect(v).toContain('botanical');
  });

  it('is just the word when there is no stem', () => {
    expect(keywordVariants('magic')).toEqual(['magic', 'Magic']);
  });
});

describe('stemmedQueryRegex', () => {
  it('matches a collection named for the noun', () => {
    expect(stemmedQueryRegex('botanical').test('Botany & Herbals')).toBe(true);
    expect(stemmedQueryRegex('alchemical texts').test('Alchemical texts of the Renaissance')).toBe(true);
  });

  it('escapes regex metacharacters', () => {
    expect(() => stemmedQueryRegex('a+b (c')).not.toThrow();
  });
});
