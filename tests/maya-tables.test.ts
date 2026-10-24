import { describe, it, expect } from 'vitest';
import {
  ECLIPSE_GROUPS, FORSTEMANN_TOTALS, VENUS_ROWS, fromOneAjaw, venusDays,
} from '@/app/articles/maya-mathematics/tables';

describe('Dresden Venus table', () => {
  it('opens on 3 Kib, as Bowditch calculates for the first column of Dresden 46', () => {
    const d = fromOneAjaw(venusDays(0));
    expect(venusDays(0)).toBe(236);
    expect(`${d.number} ${d.name}`).toBe("3 Kib'");
  });

  it('runs 2,920 days a row and 37,960 for thirteen rows, back to 1 Ajaw', () => {
    expect(venusDays(19)).toBe(2920);
    const last = VENUS_ROWS * 20 - 1;
    expect(venusDays(last)).toBe(37960);
    const d = fromOneAjaw(venusDays(last));
    expect(`${d.number} ${d.name}`).toBe('1 Ajaw');
  });

  it('puts 2 Kan on Dresden 46 and 11 Ajaw on Dresden 50 in the row third from the bottom (Bowditch)', () => {
    const row = VENUS_ROWS - 3;
    const a = fromOneAjaw(venusDays(row * 20 + 3));
    const b = fromOneAjaw(venusDays(row * 20 + 19));
    expect(`${a.number} ${a.name}`).toBe("2 K'an");
    expect(`${b.number} ${b.name}`).toBe('11 Ajaw');
    expect(venusDays(row * 20 + 19) - venusDays(row * 20 + 3)).toBe(4 * 584);
  });

  it('makes 33,280 (Dresden 24, Förstemann) both 57 Venus cycles less 8 days and 128 runs of 260', () => {
    expect(57 * 584 - 8).toBe(33280);
    expect(33280 % 260).toBe(0);
  });
});

describe('Dresden eclipse table', () => {
  const totals = ECLIPSE_GROUPS.reduce<number[]>((acc, g) => [...acc, (acc.at(-1) ?? 0) + g.days], []);

  it('reproduces every running total in Förstemann\'s table', () => {
    expect(totals).toEqual(FORSTEMANN_TOTALS);
  });

  it('has 69 groups of 405 lunar months in 11,958 days', () => {
    expect(ECLIPSE_GROUPS).toHaveLength(69);
    expect(ECLIPSE_GROUPS.reduce((a, g) => a + g.months, 0)).toBe(405);
    expect(totals.at(-1)).toBe(11958);
  });
});
