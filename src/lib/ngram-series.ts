/**
 * Series math for the ngram viewer — shared by /api/ngrams and unit tests.
 * App-side only (the batch build stores raw counts; frequency and smoothing are
 * derived at read time so they can be re-parameterized per request).
 */

export interface NgramPoint {
  year: number;
  count: number;
  /** Occurrences per million tokens of the corpus in that year. */
  perMillion: number;
  /** Centered moving average of perMillion over ±smoothing years. */
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
