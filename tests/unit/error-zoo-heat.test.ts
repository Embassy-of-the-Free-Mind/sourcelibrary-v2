import { describe, it, expect } from 'vitest';
import { buildHeatGrid, stepFor, MIN_PAGES, DEFECT_STEP_BOUNDS } from '@/lib/error-zoo-heat';
import zoo from '../../scripts/eval/error-zoo/site-2026-11-11.json';

describe('error zoo heat grid (#244)', () => {
  const data = {
    langs: ['Latin', 'Greek', 'Welsh'],
    bins: ['1500–49', '1550–99', '1600–49'],
    cells: [
      { lang: 'Latin', bin: '1500–49', pages: 20, serious: 5 },
      { lang: 'Latin', bin: '1550–99', pages: 3, serious: 3 },
      { lang: 'Greek', bin: '1500–49', pages: 40, serious: 30 },
      { lang: 'Welsh', bin: '1600–49', pages: 4, serious: 1 },
    ],
  };

  it('shows a share only at MIN_PAGES or more and drops rows and bins with no solid square', () => {
    const g = buildHeatGrid(data);
    expect(g.bins).toEqual(['1500–49']);
    expect(g.rows.map(r => r.lang)).toEqual(['Greek', 'Latin']); // Welsh has none; sorted by pages
    expect(g.rows[1].squares[0]).toMatchObject({ kind: 'rate', rate: 0.25, step: 2 });
    expect(buildHeatGrid(data, 3).rows.find(r => r.lang === 'Latin')!.squares[1]).toMatchObject({ kind: 'rate', rate: 1 });
    expect(buildHeatGrid(data, 25).rows.find(r => r.lang === 'Latin')).toBeUndefined();
  });

  it('greys a thin square and leaves a missing one empty', () => {
    const g = buildHeatGrid({ ...data, cells: [...data.cells, { lang: 'Latin', bin: '1550–99', pages: 3, serious: 3 }, { lang: 'Greek', bin: '1550–99', pages: 9, serious: 0 }] });
    expect(g.bins).toEqual(['1500–49', '1550–99']);
    expect(g.rows.find(r => r.lang === 'Latin')!.squares[1]).toEqual({ kind: 'thin', pages: 3 });
    const h = buildHeatGrid({ ...data, cells: [...data.cells.filter(c => c.lang !== 'Latin' || c.bin !== '1550–99'), { lang: 'Greek', bin: '1550–99', pages: 9, serious: 0 }] });
    expect(h.rows.find(r => r.lang === 'Latin')!.squares[1]).toEqual({ kind: 'empty' });
  });

  it('a square needs MIN_BOOKS books when cells carry books (5 pages a book is not 8 independent pages)', () => {
    const d = { langs: ['Hebrew', 'Latin'], bins: ['before 1450', '1450–99'], cells: [
      { lang: 'Hebrew', bin: 'before 1450', pages: 40, books: 3, serious: 39 },
      { lang: 'Hebrew', bin: '1450–99', pages: 10, books: 4, serious: 5 },
      { lang: 'Latin', bin: 'before 1450', pages: 30, books: 9, serious: 27 },
    ] };
    const hebrew = buildHeatGrid(d).rows.find(r => r.lang === 'Hebrew')!;
    expect(hebrew.squares[0]).toEqual({ kind: 'thin', pages: 40, books: 3 });
    expect(hebrew.squares[1]).toMatchObject({ kind: 'rate', rate: 0.5 });
  });

  it('the defects map: a value per cell, books counted, more solid squares than the weekly audit alone', () => {
    const D = zoo.defects;
    expect(D.n_pages).toBe(D.n_weekly + D.n_fifths);
    expect(D.heat.cells.reduce((s, c) => s + c.pages, 0)).toBe(D.n_pages);
    expect(D.heat.cells.every(c => c.value >= 0 && c.books >= 1 && c.books <= c.pages && c.words > 0)).toBe(true);
    // A one-page square can be extreme (28 words, 5 findings); squares the map shows stay in a plausible range.
    expect(D.heat.cells.filter(c => c.pages >= MIN_PAGES && c.books >= 4).every(c => c.value < 60)).toBe(true);
    expect(D.heat.bins).toContain('date unknown');
    expect(D.heat.langs).not.toContain('und');
    const solid = (cells: { pages: number; books?: number }[]) => cells.filter(c => c.pages >= MIN_PAGES && (c.books ?? 99) >= 4).length;
    expect(solid(D.heat.cells)).toBeGreaterThan(solid(zoo.heat_uniform.cells));
    // a value-carrying cell renders its value, not serious / pages
    const g = buildHeatGrid({ langs: ['Latin'], bins: ['1450–99'], cells: [{ lang: 'Latin', bin: '1450–99', pages: 20, books: 9, value: 10.8 }] }, { bounds: DEFECT_STEP_BOUNDS });
    expect(g.rows[0].squares[0]).toMatchObject({ kind: 'rate', rate: 10.8, step: 3 });
  });

  it('the script and density cuts cover every page of the map, in their stated columns', () => {
    const D = zoo.defects;
    for (const [cut, totals] of [[D.by_script, D.script_totals], [D.by_density, D.density_totals]] as const) {
      expect(cut.cells.reduce((s, c) => s + c.pages, 0)).toBe(D.n_pages);
      expect(cut.cells.every(c => cut.bins.includes(c.bin) && c.value >= 0)).toBe(true);
      expect(Object.values(totals).reduce((s, t) => s + t.pages, 0)).toBe(D.n_pages);
    }
    expect(D.by_script.bins).toEqual(['print', 'manuscript', 'mixed', 'unknown']);
    expect(buildHeatGrid(D.by_script, { bounds: DEFECT_STEP_BOUNDS }).rows.length).toBeGreaterThan(3);
  });

  it('colour steps break at 10, 20, 35 and 50%', () => {
    expect([0, 0.099, 0.1, 0.2, 0.349, 0.35, 0.5, 1].map(r => stepFor(r))).toEqual([0, 0, 1, 2, 2, 3, 4, 4]);
    expect([0.5, 1, 4.9, 9.9, 20, 34].map(r => stepFor(r, DEFECT_STEP_BOUNDS))).toEqual([0, 1, 1, 2, 4, 4]);
  });

  it('the committed data is aggregates only and matches its own totals', () => {
    const H = zoo.heat_uniform;
    // The map holds only dated pages in languages with 40+ dated pages (zoo-stats.py heat()), so it is a subset.
    const pages = H.cells.reduce((s, c) => s + c.pages, 0);
    expect(pages).toBeGreaterThan(0);
    expect(pages).toBeLessThanOrEqual(zoo.n_uniform);
    expect(H.cells.reduce((s, c) => s + c.serious, 0)).toBeLessThanOrEqual(zoo.uniform_serious);
    expect(H.cells.every(c => c.serious <= c.pages && H.langs.includes(c.lang) && H.bins.includes(c.bin))).toBe(true);
    expect(JSON.stringify(zoo)).not.toMatch(/specimens/);
    expect(buildHeatGrid(H).rows.length).toBeGreaterThan(0);
    expect(buildHeatGrid(H).rows.every(r => r.squares.some(s => s.kind === 'rate' && s.pages >= MIN_PAGES))).toBe(true);
  });
});
