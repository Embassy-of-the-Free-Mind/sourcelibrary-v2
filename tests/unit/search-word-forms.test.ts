import { describe, it, expect } from 'vitest';
import { matchStem, matchStems, hasWordForms, keywordVariants, stemmedQueryRegex } from '@/lib/search/word-forms';

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

  // Second pass: measured 2026-10-07, each of these found a fraction of what
  // its sibling finds (magical 35 / magic 176, optical 1 / optics 51).
  it('joins forms whose root has four letters', () => {
    const pairs: [string, string][] = [
      ['magical', 'magic'],
      ['mystical', 'mystic'],
      ['musical', 'music'],
      ['optical', 'optics'],
      ['witches', 'witch'],
      ['astronomer', 'astronomy'],
      ['astronomers', 'astronomical'],
      ['philosopher', 'philosophy'],
      ['magician', 'magic'],
      ['kabbalistic', 'kabbalist'],
      ['botanists', 'botany'],
    ];
    for (const [a, b] of pairs) expect(matchStem(a), `${a} / ${b}`).toBe(matchStem(b));
  });

  it('has no general -al, -er or -ian rule', () => {
    expect(matchStem('general')).toBe('general');
    expect(matchStem('silver')).toBe('silver');
    expect(matchStem('Luther')).toBe('luther');
    expect(matchStem('Kepler')).toBe('kepler');
    // Names: Herodian is not Herod(otus), Christian is not Christ(opher).
    expect(matchStem('Herodian')).toBe('herodian');
    expect(matchStem('Christian')).toBe('christian');
    expect(matchStem('Justinian')).toBe('justinian');
    // The agent rules need a real root in front of them.
    expect(matchStem('loger')).toBe('loger');
    expect(matchStem('physician')).toBe('physic');
  });

  it('is always a prefix of the word', () => {
    const words = ['botanical', 'witches', 'prophecies', 'studies', 'astronomers', 'magicians', 'kabbalistic',
      'churches', 'classes', 'boxes', 'Moses', 'species', 'Christian', 'surgical', 'poetry', 'Hermes', 'optics',
      'physician', 'mathematicians', 'philosophers', 'loger'];
    for (const w of words) expect(w.toLowerCase().startsWith(matchStem(w)), w).toBe(true);
  });
});

describe('matchStems', () => {
  it('adds the stems of a family no suffix rule joins', () => {
    expect(matchStems('medical')).toEqual(['medic']);
    expect(matchStems('medicine')).toEqual(['medic']);
    expect(matchStems('herbal')).toEqual(['herba', 'herbs', 'herbes']);
    expect(matchStems('herbs')).toEqual(['herba', 'herbs', 'herbes']);
    expect(matchStems('poetry').sort()).toEqual(['poem', 'poet']);
    expect(matchStems('surgical').sort()).toEqual(['chirurg', 'surg']);
    expect(matchStems('chymical').sort()).toEqual(['chemi', 'chymi']);
    expect(matchStems('witchcraft')).toEqual(['witch']);
  });

  it('is the one stem for an ordinary word', () => {
    expect(matchStems('botanical')).toEqual(['botan']);
    expect(matchStems('Paracelsus')).toEqual(['paracelsus']);
  });
});

// non-latin-text-operations.md: a helper that reduces non-Latin input to
// nothing, or to something else, reports "no books" for a query it never ran.
describe('words that must pass through untouched', () => {
  const untouched = ['本草', '煉丹', 'الكيمياء', 'קבלה', 'ज्योतिष', 'φιλοσοφία', 'алхимия', 'Ἑρμῆς', 'Kräuterbuch', 'Saʻdī', 'Paracelsus', 'alchymia', 'magic'];
  it.each(untouched)('%s has no related forms and is matched as typed', (w) => {
    expect(hasWordForms(w)).toBe(false);
    expect(matchStems(w)).toEqual([w.toLowerCase()]);
    expect(keywordVariants(w).map(v => v.toLowerCase())).toEqual(expect.arrayContaining([w.toLowerCase()]));
    expect(new Set(keywordVariants(w).map(v => v.toLowerCase())).size).toBe(1);
    const rx = stemmedQueryRegex(w);
    expect(rx.source).not.toContain('\\b');
    expect(rx.test(`De ${w} libri`)).toBe(true);
    expect(rx.test(`x${w}x`)).toBe(true); // as typed: a substring, no word boundary
  });

  it('keeps a non-Latin word inside a mixed query', () => {
    expect(stemmedQueryRegex('botanical 本草').test('Botany 本草綱目')).toBe(true);
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

  it('reaches the family forms', () => {
    expect(keywordVariants('medical')).toEqual(expect.arrayContaining(['medicine', 'Medicine', 'medicinal']));
    expect(keywordVariants('herbal')).toEqual(expect.arrayContaining(['herbs', 'Herbalism']));
    expect(keywordVariants('astronomer')).toEqual(expect.arrayContaining(['astronomy', 'Astronomy']));
  });
});

describe('stemmedQueryRegex', () => {
  it('matches a collection named for the noun', () => {
    expect(stemmedQueryRegex('botanical').test('Botany & Herbals')).toBe(true);
    expect(stemmedQueryRegex('alchemical texts').test('Alchemical texts of the Renaissance')).toBe(true);
  });

  it('matches a stem only at the start of a word', () => {
    expect(stemmedQueryRegex('optical').test('Optics and catoptrics')).toBe(true);
    expect(stemmedQueryRegex('optical').test('Coptic manuscripts')).toBe(false);
    expect(stemmedQueryRegex('herbal').test('Herbarius latinus')).toBe(true);
    expect(stemmedQueryRegex('herbal').test('Sherborne missal')).toBe(false);
    // "herb" alone starts a town named in hundreds of imprints.
    expect(stemmedQueryRegex('herbal').test('Herbornae Nassoviorum, 1612')).toBe(false);
    expect(stemmedQueryRegex('herbs').test('Mysterium sigillorum, herbarum & lapidum')).toBe(true);
  });

  it('still matches the word as typed anywhere, as the plain regex did', () => {
    expect(stemmedQueryRegex('botanical').test('Ethnobotanical notes')).toBe(true);
  });

  it('matches a family in either form', () => {
    expect(stemmedQueryRegex('medical').test('History of Medicine')).toBe(true);
    expect(stemmedQueryRegex('surgery').test('Chirurgia magna')).toBe(true);
    expect(stemmedQueryRegex('poetry').test('Poems of the East')).toBe(true);
  });

  it('escapes regex metacharacters', () => {
    expect(() => stemmedQueryRegex('a+b (c')).not.toThrow();
  });
});
