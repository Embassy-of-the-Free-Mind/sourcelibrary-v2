import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs script, no types
import { workLane, iaLane, GENRE_FLOOR_RE } from '../../scripts/audit/truncated-ingests.mjs';

describe('truncated-ingests lanes (#4442)', () => {
  it('flags a one-page witness of a work held elsewhere at 1,249 pages (al-Qanun)', () => {
    expect(workLane(1, [1249, 400])).toEqual({ sibling_max: 1249, siblings: 2 });
  });
  it('does not flag a one-leaf tablet whose siblings are also tiny', () => {
    expect(workLane(1, [2, 3])).toBeNull();
    expect(workLane(1, [])).toBeNull();
  });
  it('needs the sibling to be both absolutely large and many times bigger', () => {
    expect(workLane(8, [60])).toBeNull(); // 60 < 10×8
    expect(workLane(3, [40])).toBeNull(); // 40 < 50
  });
  it('IA lane fires against an upstream extent, not on a small item', () => {
    expect(iaLane(1, 301)).toEqual({ source_pages: 301 });
    expect(iaLane(1, 4)).toBeNull();
    expect(iaLane(10, 30)).toBeNull();
  });
  it('genre floor matches whole words, not prefixes', () => {
    expect(GENRE_FLOOR_RE.test('al-Qanun (Canon of Medicine)')).toBe(true);
    expect(GENRE_FLOOR_RE.test('Thucydides (Books 1-2, Loeb)')).toBe(true);
    expect(GENRE_FLOOR_RE.test('Method of Operating Arc Lamps')).toBe(false);
    expect(GENRE_FLOOR_RE.test('Lectori Benevolo Gaudere')).toBe(false);
    expect(GENRE_FLOOR_RE.test('Bodleian Library MS. Canon. Gr. 101')).toBe(false); // shelfmark, not a genre
  });
});
