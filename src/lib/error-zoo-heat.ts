/**
 * PRIOR ART: scripts/eval/error-zoo/zoo-page.html (the claude.ai artifact's canvas heat map, client JS over
 * zoo-stats.json) — the same cells, but drawn in the browser from the whole zoo document; the site needs a small,
 * server-rendered grid from aggregates only. src/components/explore/CenturyHeatmap.tsx counts entities, not errors.
 *
 * The error zoo's heat map (#244 step 2): languages down the side, half-centuries across, each square the share of
 * reviewed pages with an error (the `serious` field holds the count, possibly fractional after a scale offset).
 * Squares under MIN_PAGES pages, or under minBooks books when the cells carry `books`, are shown as thin, not as a
 * rate. Data: scripts/eval/error-zoo/site-2026-11-11.json (zoo-stats.py; the pooled map from pooled-meaning.py).
 */

export const MIN_PAGES = 8;
/** Books a square needs when cells carry `books` (the pooled map: paired-fifths reads 5 pages a book). */
export const MIN_BOOKS = 4;

export interface HeatCell {
  lang: string;
  bin: string;
  pages: number;
  /** Pages (or weighted findings) counted as bad; the share is serious / pages. Not used when `value` is set. */
  serious?: number;
  /** A rate given directly, e.g. defects per 1,000 words (the defects map); takes precedence over serious / pages. */
  value?: number;
  books?: number;
  findings?: number;
  by?: Partial<Record<'minor' | 'moderate' | 'serious', number>>;
}

export interface HeatData {
  langs: string[];
  bins: string[];
  cells: HeatCell[];
}

export type Square =
  | { kind: 'empty' }
  | { kind: 'thin'; pages: number; books?: number }
  | { kind: 'rate'; pages: number; books?: number; rate: number; step: number };

export interface HeatRow {
  lang: string;
  pages: number;
  squares: Square[];
}

/** Upper bounds of the colour steps for the "serious" scale: under 10%, 10–20%, 20–35%, 35–50%, 50% and over. */
export const STEP_BOUNDS = [0.1, 0.2, 0.35, 0.5];
/** For defects per 1,000 words: the book-grade bars (A at most 1, B at most 5), then 10 and 20. */
export const DEFECT_STEP_BOUNDS = [1, 5, 10, 20];

export function stepFor(rate: number, bounds: number[] = STEP_BOUNDS): number {
  const i = bounds.findIndex(b => rate < b);
  return i === -1 ? bounds.length : i;
}

export interface GridOptions { minPages?: number; minBooks?: number; bounds?: number[] }

/**
 * One row per language, in descending order of pages reviewed. Languages with no square at MIN_PAGES or more are
 * left out (a row of grey squares tells a reader nothing), as are bins with no square at MIN_PAGES in any kept row.
 */
export function buildHeatGrid(data: HeatData, opts: GridOptions | number = {}): { bins: string[]; rows: HeatRow[] } {
  const { minPages = MIN_PAGES, minBooks = MIN_BOOKS, bounds = STEP_BOUNDS } = typeof opts === 'number' ? { minPages: opts } : opts;
  const byKey = new Map(data.cells.map(c => [`${c.lang}|${c.bin}`, c]));
  const solid = (c: HeatCell | undefined) => !!c && c.pages >= minPages && (c.books == null || c.books >= minBooks);
  const langs = data.langs.filter(l => data.bins.some(b => solid(byKey.get(`${l}|${b}`))));
  const bins = data.bins.filter(b => langs.some(l => solid(byKey.get(`${l}|${b}`))));
  const rows = langs.map(lang => {
    const squares: Square[] = bins.map(bin => {
      const c = byKey.get(`${lang}|${bin}`);
      if (!c || c.pages === 0) return { kind: 'empty' };
      if (!solid(c)) return { kind: 'thin', pages: c.pages, books: c.books };
      const rate = c.value ?? (c.serious ?? 0) / c.pages;
      return { kind: 'rate', pages: c.pages, books: c.books, rate, step: stepFor(rate, bounds) };
    });
    const pages = data.cells.filter(c => c.lang === lang).reduce((s, c) => s + c.pages, 0);
    return { lang, pages, squares };
  });
  rows.sort((a, b) => b.pages - a.pages);
  return { bins, rows };
}
