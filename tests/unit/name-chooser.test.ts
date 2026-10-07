import { describe, it, expect, vi, beforeEach } from 'vitest';

// Both lookups are mocked; the grouping under test is pure.
const find = vi.fn();
const aggregate = vi.fn();
vi.mock('@/lib/mongodb', () => ({
  getDb: async () => ({ collection: () => ({ find, aggregate }) }),
}));

import {
  bareNameQuery,
  bearsSurname,
  buildNameChoices,
  findNameChoices,
  lifeDates,
  namedBeforeBorn,
  oneLine,
  wikidataYear,
  type ChooserRecord,
} from '@/lib/search/name-chooser';

// #5950: a reader who types "Bacon" must be offered Roger and Francis, not one blended person —
// and a query that is not a bare name must not cost a lookup.

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

// The live shape (2026-10-06), cut down: the bare record carries Francis's id and both men's books.
const BACON: ChooserRecord[] = [
  { name: 'Roger Bacon', wikidata_id: 'Q171677', wikidata_birth_date: '1220-00-00', wikidata_death_date: '1292-00-00', description: 'A 13th-century English Franciscan friar and scholastic philosopher. He wrote much.', book_ids: ids('r', 40) },
  { name: 'Bacon', wikidata_id: 'Q37388', wikidata_birth_date: '1561-01-22', wikidata_death_date: '1626-04-09', description: 'Refers to either Roger Bacon or Francis Bacon.', book_ids: ids('b', 30) },
  { name: 'Francis Bacon', wikidata_id: 'Q37388', wikidata_birth_date: '1561-01-22', wikidata_death_date: '1626-04-09', description: 'An English philosopher and statesman.', book_ids: ids('f', 20) },
  { name: 'Lord Bacon', wikidata_id: 'Q37388', book_ids: [...ids('f', 5), ...ids('l', 4)] },
  { name: 'Bacon, Roger', book_ids: ids('x', 7) },
  { name: 'Friar Bacon', book_ids: ids('y', 12) },
  { name: 'Sir Francis Bacon', wikidata_id: 'Q5480096', wikidata_birth_date: '1587-01-01', wikidata_death_date: '1657-01-01', book_ids: ['s0'] },
];

describe('bearsSurname', () => {
  it('accepts the surname in last place, before a comma, or before a particle', () => {
    expect(bearsSurname('Roger Bacon', 'Bacon')).toBe(true);
    expect(bearsSurname('Bacon, Roger', 'bacon')).toBe(true);
    expect(bearsSurname('Fabricius ab Aquapendente', 'Fabricius')).toBe(true);
    expect(bearsSurname('Bacon of Verulam', 'Bacon')).toBe(true);
    expect(bearsSurname('Francis Bacon (Lord Verulam)', 'Bacon')).toBe(true);
    expect(bearsSurname('Max Müller', 'Muller')).toBe(true);
  });

  it('refuses a forename, a middle name, and the bare surname itself', () => {
    expect(bearsSurname('Hartmann Schedel', 'Hartmann')).toBe(false);
    expect(bearsSurname('Johann Hartmann Beyer', 'Hartmann')).toBe(false);
    expect(bearsSurname('Bacon', 'Bacon')).toBe(false);
    expect(bearsSurname('Bacon (Roger Bacon)', 'Bacon')).toBe(false);
    expect(bearsSurname('Verulam (Francis Bacon)', 'Bacon')).toBe(false);
    expect(bearsSurname('Baconthorpe', 'Bacon')).toBe(false);
  });
});

describe('dates and the one-line description', () => {
  it('reads Wikidata years, including year-only and BC dates', () => {
    expect(wikidataYear('1561-01-22')).toBe(1561);
    expect(wikidataYear('1220-00-00')).toBe(1220);
    expect(wikidataYear('-0063-00-00')).toBe(-63);
    expect(wikidataYear('0160-00-00')).toBe(160);
    expect(wikidataYear(null)).toBeNull();
    expect(wikidataYear('0000-00-00')).toBeNull();
  });

  it('formats a life span without inventing the missing end', () => {
    expect(lifeDates('1561-01-22', '1626-04-09')).toBe('1561–1626');
    expect(lifeDates('-0063', '-0012')).toBe('63–12 BC');
    expect(lifeDates('-0004', '0065')).toBe('4 BC–AD 65');
    expect(lifeDates(null, '1700-00-00')).toBe('d. 1700');
    expect(lifeDates('1894-02-22', null)).toBe('b. 1894');
    expect(lifeDates(null, undefined)).toBeNull();
  });

  it('keeps the first sentence and does not stop at an initial', () => {
    expect(oneLine('An English philosopher and statesman. He was also a lawyer.')).toBe('An English philosopher and statesman.');
    expect(oneLine('The pupil of J. C. Scaliger at Agen. Later a physician.')).toBe('The pupil of J. C. Scaliger at Agen.');
    expect(oneLine('  ')).toBeNull();
    const long = oneLine(`${'A scholar of very many subjects and '.repeat(8)}more.`) as string;
    expect(long.length).toBeLessThanOrEqual(141);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('namedBeforeBorn', () => {
  it('flags an id whose owner was born after the books that name the person', () => {
    expect(namedBeforeBorn(1933, [1750, 1771, 1780, 1802, 1810, 1990])).toBe(true);
  });
  it('says nothing without a birth year, with few dated books, or for a posthumous reputation', () => {
    expect(namedBeforeBorn(null, [1750, 1771, 1780, 1802, 1810])).toBe(false);
    expect(namedBeforeBorn(1933, [1750, 1771])).toBe(false);
    expect(namedBeforeBorn(1220, [1561, 1620, 1700, 1850, 1925])).toBe(false);
  });
});

describe('buildNameChoices', () => {
  it('offers the people who are named in full, largest first, and never the bare record', () => {
    const out = buildNameChoices('bacon', BACON, new Map([['Q171677', 'roger-bacon']]));
    expect(out?.surname).toBe('Bacon');
    expect(out?.choices.map(c => c.name)).toEqual(['Roger Bacon', 'Francis Bacon']);
    const [roger, francis] = out!.choices;
    expect(roger).toMatchObject({ wikidata_id: 'Q171677', dates: '1220–1292', book_count: 40, href: '/author/roger-bacon', href_kind: 'author' });
    expect(roger.who).toBe('A 13th-century English Franciscan friar and scholastic philosopher.');
    // Francis + Lord Bacon share an id: 20 + 4 new books. The bare record's 30 are not counted.
    expect(francis).toMatchObject({ book_count: 24, dates: '1561–1626', href: '/encyclopedia/Francis%20Bacon', href_kind: 'encyclopedia' });
    expect(francis.who).toBe('An English philosopher and statesman.');
  });

  it('leaves out records with no Wikidata id and ids too small to trust', () => {
    const out = buildNameChoices('Bacon', BACON);
    // "Friar Bacon" (12 books, no id) and "Sir Francis Bacon" (a judge's id, 1 book) are not choices.
    expect(out?.choices.map(c => c.wikidata_id)).toEqual(['Q171677', 'Q37388']);
  });

  it('returns null when only one person qualifies', () => {
    expect(buildNameChoices('Bacon', BACON.filter(r => r.wikidata_id !== 'Q171677'))).toBeNull();
    expect(buildNameChoices('Paracelsus', [{ name: 'Paracelsus', wikidata_id: 'Q83428', book_ids: ids('p', 900) }])).toBeNull();
    expect(buildNameChoices('Bacon', [])).toBeNull();
  });

  it('does not offer a forename match ("Hartmann Schedel" for Hartmann)', () => {
    const out = buildNameChoices('Hartmann', [
      { name: 'Franz Hartmann', wikidata_id: 'Q215892', book_ids: ids('a', 22) },
      { name: 'Hartmann Schedel', wikidata_id: 'Q58768', book_ids: ids('b', 16) },
      { name: 'Eduard von Hartmann', wikidata_id: 'Q77057', book_ids: ids('c', 19) },
    ]);
    expect(out?.choices.map(c => c.name)).toEqual(['Franz Hartmann', 'Eduard von Hartmann']);
  });

  it('joins one person held under two ids, and keeps brothers apart', () => {
    const montanus = buildNameChoices('Montanus', [
      { name: 'Arias Montanus', wikidata_id: 'Q816903', wikidata_birth_date: '1527-01-01', wikidata_death_date: '1598-07-06', book_ids: ids('a', 50) },
      { name: 'Benedict Arias Montanus', wikidata_id: 'Q134710135', wikidata_birth_date: '1527-00-00', wikidata_death_date: '1598-00-00', book_ids: ids('b', 11) },
    ]);
    expect(montanus).toBeNull(); // one person, so nothing to choose

    const bauhin = buildNameChoices('Bauhin', [
      { name: 'Caspar Bauhin', wikidata_id: 'Q123612', wikidata_birth_date: '1560-01-17', wikidata_death_date: '1624-12-05', book_ids: ids('c', 67) },
      { name: 'Johann Bauhin', wikidata_id: 'Q123660', wikidata_birth_date: '1541-12-12', wikidata_death_date: '1612-10-26', book_ids: ids('j', 25) },
    ]);
    expect(bauhin?.choices).toHaveLength(2);
  });

  it('drops a person whose id belongs to someone born after the books were printed', () => {
    const out = buildNameChoices('Smith', [
      { name: 'Adam Smith', wikidata_id: 'Q9381', wikidata_birth_date: '1723-06-05', book_ids: ids('a', 85), book_years: [1776, 1790, 1850] },
      { name: 'John Smith', wikidata_id: 'Q2314046', wikidata_birth_date: '1618-01-01', book_ids: ids('j', 26), book_years: [1660, 1673] },
      { name: 'William Smith', wikidata_id: 'Q975046', wikidata_birth_date: '1933-01-01', book_ids: ids('w', 12), book_years: [1750, 1771, 1780, 1802, '1810', null] },
    ]);
    expect(out?.choices.map(c => c.name)).toEqual(['Adam Smith', 'John Smith']);
  });

  it('never shows more than five people', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ name: `Person${i} Smith`, wikidata_id: `Q${i}`, book_ids: ids(`p${i}-`, 20 + i) }));
    expect(buildNameChoices('Smith', many)?.choices).toHaveLength(5);
  });
});

describe('findNameChoices', () => {
  const cursor = (rows: unknown[]) => ({ limit: () => ({ toArray: async () => rows }) });
  beforeEach(() => {
    find.mockReset();
    aggregate.mockReset();
  });

  it('does no lookup at all for a query that is not one bare word', async () => {
    expect(bareNameQuery('Roger Bacon')).toBeNull();
    expect(bareNameQuery('"Bacon"')).toBeNull();
    expect(bareNameQuery('  ')).toBeNull();
    expect(bareNameQuery(' Bacon ')).toBe('Bacon');
    for (const q of ['philosophers stone', 'Roger Bacon', '"Bacon"', 'alchemy and medicine', '']) {
      expect(await findNameChoices(q)).toBeNull();
    }
    expect(find).not.toHaveBeenCalled();
    expect(aggregate).not.toHaveBeenCalled();
  });

  it('does not run the entities search for a word that names no person', async () => {
    find.mockReturnValue(cursor([{ name: 'Alchemy', type: 'concept', book_count: 900 }]));
    expect(await findNameChoices('Alchemy')).toBeNull();
    expect(aggregate).not.toHaveBeenCalled();
  });

  it('returns the choices for a bare surname, with author links where the thesaurus has the person', async () => {
    find.mockImplementation((filter: Record<string, unknown>) => {
      if ('wikidata_id' in filter) return cursor([{ _id: 'roger-bacon', slug: 'roger-bacon', wikidata_id: 'Q171677' }, { _id: 'bacon-roger', wikidata_id: 'Q171677', merged_into: 'roger-bacon' }]);
      if ('aliases' in filter) return cursor([]);
      return cursor([{ name: 'Bacon', type: 'person', book_count: 211 }]);
    });
    aggregate.mockReturnValue({ toArray: async () => BACON });
    const out = await findNameChoices('bacon');
    expect(out?.choices.map(c => c.href)).toEqual(['/author/roger-bacon', '/encyclopedia/Francis%20Bacon']);
    expect(aggregate).toHaveBeenCalledTimes(1);
    const [pipeline] = aggregate.mock.calls[0];
    expect(pipeline[0].$search.index).toBe('entities_search');

    // Cached: a second ask costs nothing.
    await findNameChoices('Bacon');
    expect(aggregate).toHaveBeenCalledTimes(1);
  });

  it('yields no chooser, and does not cache, when the search fails', async () => {
    find.mockImplementation((filter: Record<string, unknown>) =>
      ('aliases' in filter ? cursor([]) : cursor([{ name: 'Huygens', type: 'person', book_count: 75 }])));
    aggregate.mockReturnValueOnce({ toArray: async () => { throw new Error('operation exceeded time limit'); } });
    expect(await findNameChoices('Huygens')).toBeNull();
    aggregate.mockReturnValue({ toArray: async () => [
      { name: 'Christiaan Huygens', wikidata_id: 'Q39599', book_ids: ids('c', 120) },
      { name: 'Constantijn Huygens', wikidata_id: 'Q560746', book_ids: ids('k', 45) },
    ] });
    expect((await findNameChoices('Huygens'))?.choices).toHaveLength(2);
  });
});
