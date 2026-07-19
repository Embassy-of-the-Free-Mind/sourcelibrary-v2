/**
 * Series math + term-spec parsing for the ngram viewer — shared by /api/ngrams,
 * the viewer UI, and unit tests. App-side only (the batch build stores raw
 * counts; frequency and smoothing are derived at read time so they can be
 * re-parameterized per request).
 */

import { NGRAM_CORPORA } from './ngram-normalize';

export interface TermSpec {
  /** The term text without any corpus tag. */
  term: string;
  /** Resolved corpus id for this term. */
  corpus: string;
  /** True if the corpus came from an explicit `term:corpus` tag. */
  tagged: boolean;
}

/**
 * Parse one query term with optional `:corpus` suffix — `mercurius:la` charts
 * mercurius against the Latin corpus regardless of the page's default corpus.
 * An unknown suffix is NOT treated as a tag (the colon is just text and the
 * tokenizer will drop it), so "12:30" or a stray colon can't break a query.
 */
export function parseTermSpec(raw: string, defaultCorpus: string): TermSpec {
  const idx = raw.lastIndexOf(':');
  if (idx > 0) {
    const suffix = raw.slice(idx + 1).trim().toLowerCase();
    if (NGRAM_CORPORA.some(c => c.id === suffix)) {
      return { term: raw.slice(0, idx).trim(), corpus: suffix, tagged: true };
    }
  }
  return { term: raw.trim(), corpus: defaultCorpus, tagged: false };
}

export interface NgramPoint {
  year: number;
  count: number;
  /** Occurrences per million tokens of the corpus in that year. */
  perMillion: number;
  /** Centered moving average of perMillion over ±smoothing years. */
  smoothed: number;
}

/** Doc-frequency point (?mode=docs): count is distinct books, not occurrences. */
export interface DocPoint {
  year: number;
  /** Distinct books mentioning the term at least once that year. */
  count: number;
  /** count as a percentage of the corpus's books that year. */
  pctBooks: number;
  /** Centered moving average of pctBooks over ±smoothing years. */
  smoothed: number;
}

/** Years with fewer corpus tokens than this are dropped from series — a term
 * hitting twice in a 3,000-token year would otherwise spike to ~600/million and
 * dwarf every real signal. The UI's token backdrop shows where thin years were
 * elided. */
export const MIN_YEAR_TOKENS = 10_000;

/**
 * Build a per-year frequency series from a sparse counts map.
 * Every year in [from, to] with at least MIN_YEAR_TOKENS corpus tokens becomes
 * a data point (count 0 if the term is absent — a real zero, not a gap); years
 * with a thin or absent corpus are omitted entirely.
 */
export function buildSeries(
  counts: Record<string, number>,
  totals: Map<number, number>,
  from: number,
  to: number,
  smoothing: number,
): NgramPoint[] {
  const points: Array<Omit<NgramPoint, 'smoothed'>> = [];
  for (let year = from; year <= to; year++) {
    const tokens = totals.get(year) ?? 0;
    if (tokens < MIN_YEAR_TOKENS) continue;
    const count = counts[String(year)] ?? 0;
    points.push({ year, count, perMillion: (count / tokens) * 1e6 });
  }
  const smoothed = smoothSeries(points.map(p => p.perMillion), smoothing);
  return points.map((p, i) => ({ ...p, smoothed: smoothed[i] }));
}

/**
 * Doc-frequency variant (#3217): % of each year's books that mention the term
 * at least once — immune to one wordy treatise dominating a thin year.
 * Year eligibility is the SAME token threshold as buildSeries, so both modes
 * chart an identical set of years and toggling never shifts the x-axis.
 */
export function buildDocSeries(
  booksByYear: Record<string, number>,
  tokenTotals: Map<number, number>,
  bookTotals: Map<number, number>,
  from: number,
  to: number,
  smoothing: number,
): DocPoint[] {
  const points: Array<Omit<DocPoint, 'smoothed'>> = [];
  for (let year = from; year <= to; year++) {
    const tokens = tokenTotals.get(year) ?? 0;
    if (tokens < MIN_YEAR_TOKENS) continue;
    const books = bookTotals.get(year) ?? 0;
    const count = booksByYear[String(year)] ?? 0;
    points.push({ year, count, pctBooks: books > 0 ? (count / books) * 100 : 0 });
  }
  const smoothed = smoothSeries(points.map(p => p.pctBooks), smoothing);
  return points.map((p, i) => ({ ...p, smoothed: smoothed[i] }));
}

/**
 * Centered moving average over ±window entries (Google Ngram-style smoothing).
 * Operates on adjacent data points, so gap years (thin corpus) don't contribute
 * phantom zeros. window=0 returns the input unchanged.
 */
export function smoothSeries(values: number[], window: number): number[] {
  if (window <= 0) return [...values];
  return values.map((_, i) => {
    const lo = Math.max(0, i - window);
    const hi = Math.min(values.length - 1, i + window);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += values[j];
    return sum / (hi - lo + 1);
  });
}
