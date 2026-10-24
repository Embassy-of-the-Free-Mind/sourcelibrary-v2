// #6057: the Leiden importers stored the Hijri year of "1303 [1885]" as `books.year`.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs script lib, no types
import { yearFromPublished, catalogYear } from '../../scripts/lib/catalogue-year.mjs';

describe('yearFromPublished', () => {
  it('takes the bracketed CE year after a Hijri year (real Leiden rows)', () => {
    expect(yearFromPublished('[Place of manufacture not identified], 1303 [1885]')).toBe(1885);
    expect(yearFromPublished('[Place of manufacture not identified], 1219 [1804]')).toBe(1804);
    expect(yearFromPublished('[Place of manufacture not identified], 1261 [1845 or 1847]')).toBe(1845);
    expect(yearFromPublished('1309 [before 1892]')).toBe(1892);
  });

  it('takes the bracketed year that agrees with the start of a Hijri range', () => {
    expect(yearFromPublished('1230-1240 [1815 or 1825]')).toBe(1815);
  });

  it('stores no year when the Hijri and CE years contradict each other', () => {
    expect(yearFromPublished('1308 [1820]')).toBeNull();
    expect(yearFromPublished('1312 [1933]')).toBeNull();
  });

  it('keeps the first year for everything else', () => {
    expect(yearFromPublished('Venetiis, 1505')).toBe(1505);
    expect(yearFromPublished('1450 [i.e. 1451]')).toBe(1450);
    expect(yearFromPublished('[ca. 1600]')).toBe(1600);
    expect(yearFromPublished('Unknown')).toBeNull();
    expect(yearFromPublished(null)).toBeNull();
  });

  // #6866: the live rows that put the catalogue's date range at "2030 BCE – 6957".
  it('prefers an explicit CE/AD gloss over a year in another era', () => {
    expect(yearFromPublished('9 August in the year of the world 6957, of the Hijra 853 and of Alexander the Greek 1760 (= 1449 C.E.)')).toBe(1449);
    expect(yearFromPublished('Before Tishri 6365 AM (1926 CE)')).toBe(1926);
    expect(yearFromPublished('AM 5686 [1926 CE]')).toBe(1926);
    expect(yearFromPublished('2157 [Seleucid era] (1845/1846 CE)')).toBe(1845);
    expect(yearFromPublished('AD 1520')).toBe(1520);
  });

  it('stores BCE as a negative year', () => {
    expect(yearFromPublished('c. 2575–2551 BCE')).toBe(-2575);
    expect(yearFromPublished('Pharaonic Era (3000 BCE - 323 BCE)')).toBe(-3000);
    expect(yearFromPublished('ca. 2270 BC')).toBe(-2270);
    expect(yearFromPublished('-6000')).toBe(-6000);
  });

  it('skips a Hebrew year for the CE year that follows it', () => {
    expect(yearFromPublished('26 Kisleṿ 5653? (=15 December 1892?)')).toBe(1892);
    expect(yearFromPublished('5706 [1945/46]')).toBe(1945);
  });
});

describe('catalogYear', () => {
  const now = new Date('2026-10-24T00:00:00Z');
  it('keeps a stored year, unless it is later than this year', () => {
    expect(catalogYear({ year: 1617, published: '1617' }, now)).toBe(1617);
    expect(catalogYear({ year: -2880, published: '-2880' }, now)).toBe(-2880);
    expect(catalogYear({ year: 6000, published: '-6000' }, now)).toBe(-6000);
    expect(catalogYear({ year: 2039, published: '2039' }, now)).toBeNull();
  });

  it('reads published when there is no stored year, three-digit years included', () => {
    expect(catalogYear({ published: '9 August in the year of the world 6957 (= 1449 C.E.)' }, now)).toBe(1449);
    expect(catalogYear({ published: 'ca. 850' }, now)).toBe(850);
    expect(catalogYear({ published: '951–1000' }, now)).toBe(951);
    expect(catalogYear({ published: 'c. 100–150 CE' }, now)).toBe(100);
    expect(catalogYear({ published: '5706 [1945/46]' }, now)).toBe(1945);
    expect(catalogYear({ published: '1308 [1820]' }, now)).toBeNull();
    expect(catalogYear({ published: 'Unknown' }, now)).toBeNull();
    expect(catalogYear({}, now)).toBeNull();
  });
});

