/**
 * Yucatec Maya counts in twenties, and a translator that does not know it writes the number it expects (#6559:
 * Coleccion de sermones 1846 p.200, *lahu oxkal catac oxpel* — 53 by Beltrán's table — came out "thirty-three").
 * The table rows below are Beltrán, Arte de el idioma maya (ed. 1859, 6a9f3fa483c3b522416e48fa) pp. 217–223.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs helper, no types
import { findMayaNumbers, englishNumbers, cleanMayaOcr } from '../../scripts/lib/maya-numerals.mjs';

const value = (t: string) => findMayaNumbers(t)[0]?.value ?? null;

describe('Maya numerals (Beltrán table)', () => {
  const rows: [string, number][] = [
    ['Hunkal', 20], ['Huntukal', 21], ['Lahucakal', 30], ['Buluctukal', 31], ['Oxlahutukal', 33], ['Holhucakal', 35],
    ['Cakal', 40], ['Huntuyoxkal', 41], ['Lahuyoxkal', 50], ['Oxlahutuyoxkal', 53], ['Oxkal', 60], ['Huntucankal', 61],
    ['Cankal', 80], ['Hutuyokal', 81], ['Lahuyokal', 90], ['Hokal', 100], ['Lahu uackal', 110], ['Uackal', 120],
    ['Buluc tu uuckal', 131], ['Lahunkal', 200], ['Oxlahukal', 260], ['Holhukal', 300], ['Bolonlahukal', 380],
    ['Hunbak', 400], ['Hotubak', 500], ['Cabak', 800], ['Hotu yoxbak', 900], ['Hunpic', 1000],
  ];
  it.each(rows)('%s = %d', (w, v) => expect(value(w)).toBe(v));

  it('adds catac terms, and juxtaposed terms above 400 (§311–312)', () => {
    expect(value('hunbak catac lahuyoxkal')).toBe(450);
    expect(value('hunpic holhutubak, catac oxtuyoxkal')).toBe(1743);
    expect(value('cú patic le cankal cá tac lahun bolontul ti')).toBe(99);
  });

  it('positive control: the sermon p.200 phrase is 53 and its English "thirty-three" does not state it', () => {
    const [f] = findMayaNumbers('meyhulá lahu oxkal cá tac oxpel haƀóob, iix ú ɔáic ù kikel');
    expect(f.value).toBe(53);
    expect(englishNumbers('he labored for thirty-three years').has(53)).toBe(false);
  });

  it('does not read ordinary words as numbers', () => {
    expect(findMayaNumbers('ca ten in uilic')).toEqual([]);          // "when I see", not caten
    expect(findMayaNumbers('vay yokal cab')).toEqual([]);            // yoklal "because"
    expect(findMayaNumbers('bolon, Lahun, kal')).toEqual([]);        // a word list, not one numeral
    expect(findMayaNumbers(cleanMayaOcr('<vocab>hunkal, cakal</vocab>'))).toEqual([]);
  });

  it('reads pic as 1,000 with an 8,000 alternative', () => {
    const [f] = findMayaNumbers('oxlahun pic');
    expect([f.value, f.alt]).toEqual([13000, 104000]);
  });
});

describe('English numbers', () => {
  it('reads digits, compounds, ordinals and "-fold"', () => {
    const s = englishNumbers('fifty-three years; three hundred and sixty-five days; 1,743; the third; a hundredfold');
    for (const v of [53, 365, 1743, 3, 100]) expect(s.has(v)).toBe(true);
  });
});
