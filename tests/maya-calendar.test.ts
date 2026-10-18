import { describe, it, expect } from 'vitest';
import {
  GMT, DAY_NAMES, MONTHS, jdnFromGregorian, gregorianFromJdn, longCount, tzolkin, haab, lordOfNight,
  vigesimal, calendrical, lcm,
} from '@/app/articles/maya-mathematics/maya';

// Anchors the article's interactives rest on. Each is a date or sum printed in a held source
// or fixed by the definition of the count.
const day = (n: number) => {
  const t = tzolkin(n);
  const h = haab(n);
  return `${t.number} ${DAY_NAMES[t.index]} ${h.day} ${MONTHS[h.month]}`;
};

describe('Maya calendar arithmetic', () => {
  it('puts the era base on 4 Ajaw 8 Kumk\'u, G9', () => {
    expect(day(0)).toBe("4 Ajaw 8 Kumk'u");
    expect(lordOfNight(0)).toBe(9);
  });

  it('places the era base in 3114 BCE (astronomical year -3113) under GMT', () => {
    expect(gregorianFromJdn(GMT)).toEqual({ y: -3113, m: 8, d: 11 });
  });

  it('reaches 13.0.0.0.0 4 Ajaw 3 K\'ank\'in on 21 December 2012', () => {
    const n = jdnFromGregorian(2012, 12, 21) - GMT;
    expect(n).toBe(1872000);
    expect(longCount(n)).toEqual([13, 0, 0, 0, 0]);
    expect(day(n)).toBe("4 Ajaw 3 K'ank'in");
  });

  it('gives Pakal\'s accession, 9.9.2.4.8, as 5 Lamat 1 Mol', () => {
    expect(day(9 * 144000 + 9 * 7200 + 2 * 360 + 4 * 20 + 8)).toBe('5 Lamat 1 Mol');
  });

  it('round-trips Gregorian dates', () => {
    for (const [y, m, d] of [[2026, 10, 18], [1582, 10, 15], [-500, 3, 1]]) {
      expect(gregorianFromJdn(jdnFromGregorian(y, m, d))).toEqual({ y, m, d });
    }
  });

  it('writes Bowditch\'s worked sums from the Dresden Codex in calendar places', () => {
    // 5 x 2920 = 14,600: 2 in the fourth place, 0 in the third, 10 twenties, 0 units.
    expect(calendrical(14600)).toEqual([2, 0, 10, 0]);
    // 4 x 91 = 364: 1 in the third place, 0 twenties, 4 units.
    expect(calendrical(364)).toEqual([1, 0, 4]);
  });

  it('counts plain base 20 the way Landa and the Motul dictionary give it', () => {
    expect(vigesimal(400)).toEqual([1, 0, 0]);
    expect(vigesimal(8000)).toEqual([1, 0, 0, 0]);
  });

  it('has the cycles meet where the codex says they do', () => {
    expect(lcm(260, 365)).toBe(18980);
    expect(lcm(584, 365)).toBe(2920);
    expect(lcm(lcm(260, 365), 584)).toBe(37960);
  });
});
