import { describe, it, expect, vi, beforeEach } from 'vitest';

// The lookup is mocked; everything else under test is pure.
const find = vi.fn();
vi.mock('@/lib/mongodb', () => ({
  getDb: async () => ({ collection: () => ({ find }) }),
}));

import { buildPageSearchStage } from '@/lib/atlas-search';
import {
  MAX_NAME_VARIANTS,
  buildNameVariants,
  expandPersonNames,
  isSpellingOf,
  latinCaseForms,
  lookupCandidates,
  secondHopCandidates,
  spellingVariants,
  topicWords,
  umlautCandidates,
  type PersonNameRecord,
} from '@/lib/search/name-variants';

// #5888: "Drebbel" must find pages that print Drebelius / Drebelii / Drebbelius, and a query
// that names no person must build exactly the stage it built before.

// The live shape (2026-10-05): the short name is an alias of one record, whose other alias is
// the NAME of a second record that alone carries the single-b spelling.
const DREBBEL: PersonNameRecord[] = [
  { name: 'Drebbel', type: 'person', book_count: 17 },
  {
    name: 'Cornelis Drebbel', type: 'person', book_count: 17,
    aliases: ['Cornelius Drebbel', 'Drebbel', 'Cornelis Drebber', 'コルネリウス・ドレベル', 'Κορνέλιους Ντρέμπελ'],
  },
];
const DREBBEL_HOP: PersonNameRecord[] = [
  { name: 'Cornelius Drebbel', type: 'person', book_count: 48, aliases: ['Cornelis Drebbel', 'Cornelius Drebel'] },
];

const cursor = (rows: PersonNameRecord[]) => ({ limit: () => ({ toArray: async () => rows }) });

describe('latinCaseForms', () => {
  it('declines a surname', () => {
    expect(latinCaseForms('Drebbel')).toEqual(expect.arrayContaining(
      ['Drebbelus', 'Drebbelius', 'Drebbeli', 'Drebbelii', 'Drebbelo', 'Drebbelio', 'Drebbelum', 'Drebbelium', 'Drebbelianus', 'Drebbeliana'],
    ));
  });

  it('goes from a Latin form back to the stem and its other cases', () => {
    const forms = latinCaseForms('Drebbelius');
    expect(forms).toEqual(expect.arrayContaining(['Drebbel', 'Drebbelii', 'Drebbelium']));
    expect(forms).not.toContain('Drebbelius');
  });

  it('never produces a 1–3 letter token, whatever it is given', () => {
    const inputs = ['Dee', 'Lull', 'Jesus', 'Pius', 'Nero', 'Bruno', 'Boyle', 'Abe', 'Io', 'A', '', 'Marci', 'Fludd', 'Otto', 'Hugo', 'Anus', 'Remi'];
    for (const input of inputs) {
      for (const form of latinCaseForms(input)) expect(Array.from(form).length, `${input} → ${form}`).toBeGreaterThanOrEqual(4);
    }
    expect(latinCaseForms('Dee')).toEqual([]);
    expect(latinCaseForms('Jesus')).toEqual([]); // "Jes" is not a stem
  });

  it('abstains on non-Latin script and on names that decline differently', () => {
    for (const name of ['Πλάτων', '薛己', 'אפלטון', 'أفلاطون', 'शंकर', 'Agrippa', 'Baconis']) {
      expect(latinCaseForms(name), name).toEqual([]);
    }
  });
});

describe('spellingVariants', () => {
  it('writes doubled consonants single', () => {
    expect(spellingVariants('Kuffler')).toContain('Kufler');
    expect(spellingVariants('Drebbel')).toContain('Drebel');
  });

  it('gives plain and digraph forms of a name typed with an umlaut', () => {
    expect(spellingVariants('Küffler')).toEqual(expect.arrayContaining(['Kuffler', 'Kueffler', 'Küfler']));
  });

  it('does not invent umlauts — those are only looked up', () => {
    expect(spellingVariants('Paris')).toEqual([]);
    expect(umlautCandidates('Kuffler')).toEqual(['Küffler', 'Kueffler']);
    expect(umlautCandidates('薛己')).toEqual([]);
  });
});

describe('isSpellingOf', () => {
  it('accepts period spellings and Latin cases of one name', () => {
    const pairs: [string, string][] = [
      ['Drebbel', 'Drebelius'], ['Drebbel', 'Drebber'], ['Kuffler', 'Cufler'], ['Kuffler', 'Kiffler'],
      ['Kuffler', 'Küffler'], ['Boehme', 'Böhme'], ['Plato', 'Platon'], ['Bacon', 'Baconus'],
      ['Mercury', 'Mercurius'], ['Philip', 'Philippus'],
    ];
    for (const [a, b] of pairs) expect(isSpellingOf(a, b), `${a} ~ ${b}`).toBe(true);
  });

  it('refuses epithets, other people, and one-letter neighbours of short names', () => {
    const pairs: [string, string][] = [
      ['Mercury', 'Hermes'], ['Paris', 'Alexander'], ['Philip', 'Paracelsus'], ['Bacon', 'Baron'],
      ['Bacon', 'Verulam'], ['Erasmus', 'Eramus'], ['Plato', 'Aristokles'],
    ];
    for (const [a, b] of pairs) expect(isSpellingOf(a, b), `${a} ~ ${b}`).toBe(false);
  });

  it('cannot judge a name under four characters, in any script — never a match', () => {
    expect(isSpellingOf('Dee', 'Dee')).toBe(false);
    expect(isSpellingOf('薛己', '薛已')).toBe(false);
    expect(isSpellingOf('Yi', 'Li')).toBe(false);
    expect(isSpellingOf('Saʻdī', 'Sadi')).toBe(true); // elided mark still reaches the floor
  });
});

describe('lookupCandidates', () => {
  it('tries each span as typed and in Title Case, bounded', () => {
    const c = lookupCandidates('cornelis drebbel submarine');
    expect(c).toEqual(expect.arrayContaining(['Cornelis Drebbel', 'cornelis drebbel', 'Drebbel']));
    expect(lookupCandidates('a b c d e f g h i j k l').length).toBe(0); // prose, not a name
    const long = lookupCandidates('what did johann kuffler invent with cornelis drebbel');
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long).toEqual(expect.arrayContaining(['Kuffler', 'Drebbel', 'Cornelis Drebbel'])); // none cut by the bound
  });

  it('adds the plain form of a name typed with diacritics', () => {
    expect(lookupCandidates('Küffler')).toEqual(expect.arrayContaining(['Küffler', 'Kuffler']));
  });

  it('looks nothing up for a quoted phrase or a lone short word', () => {
    expect(lookupCandidates('"Cornelis Drebbel"')).toEqual([]);
    expect(lookupCandidates('Dee')).toEqual([]);
    expect(lookupCandidates('   ')).toEqual([]);
  });
});

describe('buildNameVariants', () => {
  it('Drebbel → Drebelius, Drebelii, Drebbelius, Drebel', () => {
    expect(secondHopCandidates('Drebbel', DREBBEL)).toContain('Cornelius Drebbel');
    const v = buildNameVariants('Drebbel', DREBBEL, DREBBEL_HOP);
    expect(v).toEqual(expect.arrayContaining(['Drebel', 'Drebber', 'Drebelius', 'Drebelii', 'Drebbelius', 'Drebbelii']));
    expect(v).not.toContain('Drebbel');
    expect(v.length).toBeLessThanOrEqual(MAX_NAME_VARIANTS);
    for (const term of v) expect(Array.from(term).length).toBeGreaterThanOrEqual(4);
  });

  it('expands the surname inside a longer query, and only the surname', () => {
    const v = buildNameVariants('Cornelis Drebbel submarine', DREBBEL, DREBBEL_HOP);
    expect(v).toContain('Drebelius');
    expect(v.some(t => /^cornel/i.test(t) || /submarin/i.test(t))).toBe(false);
  });

  it('uses alias spellings of the same name only — never epithets or other people', () => {
    const v = buildNameVariants('Mercury', [{ name: 'Mercury', type: 'person', book_count: 885, aliases: ['Hermes', 'Mercurius', 'Quicksilver'] }]);
    expect(v).toContain('Mercurius');
    expect(v).not.toContain('Hermes');
    expect(v).not.toContain('Quicksilver');
  });

  it('does not treat a name as a person when a place or concept of that name is larger', () => {
    const records: PersonNameRecord[] = [
      { name: 'Milan', type: 'person', book_count: 309, aliases: ['Alexander'] },
      { name: 'Milan', type: 'place', book_count: 9000 },
    ];
    expect(buildNameVariants('milan', records)).toEqual([]);
    expect(buildNameVariants('milan', [records[0]])).not.toEqual([]); // the control: the gate is what stops it
  });

  it('reads "John Dee" as one person: no variants for "John", none for a 3-letter surname', () => {
    const records: PersonNameRecord[] = [
      { name: 'John Dee', type: 'person', book_count: 126, aliases: ['Johannes Dee'] },
      { name: 'John', type: 'person', book_count: 4000 },
    ];
    expect(buildNameVariants('John Dee', records)).toEqual([]);
  });

  it('separates the topic words from the name', () => {
    const p: PersonNameRecord[] = [{ name: 'Paracelsus', type: 'person', book_count: 1258 }];
    expect(topicWords('Paracelsus on the plague', p)).toEqual(['plague']);
    expect(topicWords('Paracelsus', p)).toEqual([]);
    expect(topicWords('Cornelis Drebbel', DREBBEL)).toEqual([]);
    expect(topicWords('on the plague', p)).toEqual([]); // no person: nothing to separate
  });

  it('returns nothing when no record names the query', () => {
    expect(buildNameVariants('perpetual motion', [])).toEqual([]);
    expect(buildNameVariants('Drebbel', [{ name: 'Robert Fludd', type: 'person' }])).toEqual([]);
  });

  it('abstains on short non-Latin names instead of matching them to neighbours', () => {
    const records: PersonNameRecord[] = [{ name: '薛己', type: 'person', aliases: ['薛已', 'Xue Ji'] }];
    expect(buildNameVariants('薛己', records)).toEqual([]);
    // A long enough non-Latin name keeps its same-script spelling and gets no Latin endings.
    const plato = buildNameVariants('Πλάτων', [{ name: 'Plato', type: 'person', aliases: ['Πλάτων', 'Πλάτωνας', 'Platon'] }]);
    expect(plato).toEqual(['Πλάτωνας']);
  });
});

describe('buildPageSearchStage with name variants', () => {
  it('is unchanged when there are none', () => {
    const base = buildPageSearchStage('perpetual motion', ['a', 'b']);
    expect(buildPageSearchStage('perpetual motion', ['a', 'b'], {})).toEqual(base);
    expect(buildPageSearchStage('perpetual motion', ['a', 'b'], { nameVariants: [] })).toEqual(base);
    expect(JSON.stringify(buildPageSearchStage('perpetual motion', ['a', 'b'], { nameVariants: [] }))).toBe(JSON.stringify(base));
  });

  it('adds the variants as separate clauses boosted below the original term', () => {
    const base = buildPageSearchStage('Drebbel').$search.compound.should;
    const should = buildPageSearchStage('Drebbel', undefined, { nameVariants: ['Drebelius', 'Drebelii'] }).$search.compound.should;
    expect(should.slice(0, base.length)).toEqual(base); // the original clauses, untouched
    const added = should.slice(base.length);
    expect(added.map((c: any) => c.text.path)).toEqual(['translation.data', 'ocr.data']);
    for (const c of added) {
      expect(c.text.query).toEqual(['Drebelius', 'Drebelii']);
      expect(c.text.fuzzy).toBeUndefined();
      const original = base.find((b: any) => b.text.path === c.text.path);
      expect(c.text.score.boost.value).toBeLessThan(original.text.score?.boost?.value ?? 1);
    }
  });

  it('requireNameVariant: only pages printing a variant match; the query words still score', () => {
    const base = buildPageSearchStage('Paracelsus plague', 'b1');
    const stage = buildPageSearchStage('Paracelsus plague', 'b1', { nameVariants: ['Paracelsi'], requireNameVariant: true });
    const { must, should, filter, minimumShouldMatch } = stage.$search.compound;
    expect(minimumShouldMatch).toBeUndefined();
    expect(filter).toEqual(base.$search.compound.filter);
    expect(should).toEqual(base.$search.compound.should);
    expect(must).toHaveLength(1);
    expect(must[0].compound.minimumShouldMatch).toBe(1);
    expect(must[0].compound.should.map((c: any) => [c.text.path, c.text.query])).toEqual([
      ['translation.data', ['Paracelsi']], ['ocr.data', ['Paracelsi']],
    ]);
    const both = buildPageSearchStage('Paracelsus plague', 'b1', { nameVariants: ['Paracelsi'], requireNameVariant: true, requireWords: ['plague'] });
    expect(both.$search.compound.must).toHaveLength(2);
    expect(both.$search.compound.must[1].text.query).toEqual(['plague']);
    // Without variants the flag does nothing.
    expect(buildPageSearchStage('alchemy', 'b1', { requireNameVariant: true })).toEqual(buildPageSearchStage('alchemy', 'b1'));
  });

  it('ignores variants for a quoted phrase — the reader asked for those exact words', () => {
    expect(buildPageSearchStage('"Cornelis Drebbel"', undefined, { nameVariants: ['Drebelius'] }))
      .toEqual(buildPageSearchStage('"Cornelis Drebbel"'));
  });
});

describe('expandPersonNames', () => {
  beforeEach(() => { find.mockReset(); });

  it('looks nothing up and returns [] for a query with no name-shaped span', async () => {
    expect(await expandPersonNames('"an exact phrase"')).toEqual([]);
    expect(find).not.toHaveBeenCalled();
  });

  it('expands a known person, then answers from cache', async () => {
    find.mockImplementation((q: any) => {
      const names: string[] = (q.name ?? q.aliases).$in;
      const pool = [...DREBBEL, ...DREBBEL_HOP];
      return cursor(q.name
        ? pool.filter(r => names.includes(r.name))
        : pool.filter(r => (r.aliases ?? []).some(a => names.includes(a))));
    });
    const first = await expandPersonNames('Drebbel  ');
    expect(first).toEqual(expect.arrayContaining(['Drebelius', 'Drebelii', 'Drebbelius']));
    const calls = find.mock.calls.length;
    expect(calls).toBeLessThanOrEqual(4);
    expect(await expandPersonNames('drebbel')).toEqual(first);
    expect(find.mock.calls.length).toBe(calls);
  });

  it('caches "no such person" too, and makes one round of lookups for it', async () => {
    find.mockImplementation(() => cursor([]));
    expect(await expandPersonNames('quintessence distillation')).toEqual([]);
    expect(find.mock.calls.length).toBe(2);
    expect(await expandPersonNames('quintessence distillation')).toEqual([]);
    expect(find.mock.calls.length).toBe(2);
  });

  it('fails open and does NOT cache an error as "no such person"', async () => {
    find.mockImplementation(() => { throw new Error('pool was cleared'); });
    expect(await expandPersonNames('Sendivogius')).toEqual([]);
    find.mockImplementation((q: any) => cursor(q.name ? [{ name: 'Sendivogius', type: 'person', book_count: 80 }] : []));
    expect(await expandPersonNames('Sendivogius')).toContain('Sendivogii');
  });
});
