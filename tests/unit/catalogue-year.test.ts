// #6057: the Leiden importers stored the Hijri year of "1303 [1885]" as `books.year`.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs script lib, no types
import { yearFromPublished } from '../../scripts/lib/catalogue-year.mjs';

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
});
