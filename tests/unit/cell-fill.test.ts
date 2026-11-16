import { describe, it, expect } from 'vitest';
// @ts-expect-error plain .mjs module without types
import { cellOf, halfCentury, cellLang, yearOf, pickFill } from '../../scripts/audit/cell-fill.mjs';

const id = <T,>(a: T[]) => [...a];

describe('cell fill (#244)', () => {
  it('names cells the way zoo-stats.py does', () => {
    expect(halfCentury(1449)).toBe('before 1450');
    expect(halfCentury(1450)).toBe('1450–99');
    expect(halfCentury(1899)).toBe('1850 on');
    expect(halfCentury(null)).toBeNull();
    expect(cellLang('Ancient Greek')).toBe('Greek');
    expect(cellLang('Latin, Greek')).toBe('Latin');
    expect(cellLang('German and Latin')).toBe('German');
    expect(yearOf({ published: 'Basel, c. 1543' })).toBe(1543);
    expect(yearOf({ published: 'n.d.', est_year: 1610 })).toBe(1610);
    expect(cellOf({ language: 'Latin', published: '1587' })).toBe('Latin|1550–99');
    expect(cellOf({ language: 'Latin' })).toBeNull();
    expect(cellOf({ published: '1587' })).toBeNull();
  });

  const books = (lang: string, year: number, k: number, tag: string) =>
    Array.from({ length: k }, (_, i) => ({ id: `${tag}${i}`, language: lang, published: String(year) }));

  it('fills the thinnest cells first, one book per cell per pass, and skips full or too-small cells', () => {
    const frame = [
      ...books('Latin', 1560, 30, 'L'),   // has 20 pages already: full
      ...books('Greek', 1480, 12, 'G'),   // has 2
      ...books('French', 1760, 10, 'F'),  // has 0
      ...books('Welsh', 1700, 3, 'W'),    // only 3 books in the library: cannot reach 8, skipped
    ];
    const counts = new Map([['Latin|1550–99', 20], ['Greek|1450–99', 2]]);
    const picks = pickFill({ frame, counts, n: 4, shuffle: id });
    expect(picks.map((p: { cell: string }) => p.cell)).toEqual(['French|1750–99', 'Greek|1450–99', 'French|1750–99', 'Greek|1450–99']);
    const all = pickFill({ frame, counts, n: 100, shuffle: id });
    expect(all.filter((p: { cell: string }) => p.cell === 'French|1750–99')).toHaveLength(8);  // stops at the floor
    expect(all.filter((p: { cell: string }) => p.cell === 'Greek|1450–99')).toHaveLength(6);
    expect(all.some((p: { cell: string }) => p.cell.startsWith('Latin') || p.cell.startsWith('Welsh'))).toBe(false);
  });

  it('never picks an excluded book or one with no cell', () => {
    const frame = [...books('Greek', 1480, 9, 'G'), { id: 'nodate', language: 'Greek', published: '' }];
    const picks = pickFill({ frame, counts: new Map(), n: 20, exclude: new Set(['G0']), shuffle: id });
    expect(picks.map((p: { id: string }) => p.id)).not.toContain('G0');
    expect(picks.map((p: { id: string }) => p.id)).not.toContain('nodate');
    expect(picks).toHaveLength(8);
  });
});
