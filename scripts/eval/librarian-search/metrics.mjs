/**
 * Retrieval metrics for the Librarian search eval.
 *
 * All functions take:
 *   hits: ordered array of { book_slug, page_number } (best first)
 *   expected: array of { book_slug, page_min?, page_max? }
 *
 * Match rule: hit matches an expected entry when the book_slug agrees AND
 * (if page_min/page_max are set) the page_number falls within.
 *
 * The page-range tolerance exists because translations sometimes shift page
 * numbering relative to the original (front matter, blank pages, plates), so
 * pinning to an exact page would be too strict for most queries. Use exact
 * pages only when the golden-set author is confident.
 */

export function matches(hit, expected) {
  return expected.some(e => {
    if (hit.book_slug !== e.book_slug) return false;
    if (e.page_min != null && hit.page_number < e.page_min) return false;
    if (e.page_max != null && hit.page_number > e.page_max) return false;
    return true;
  });
}

/**
 * Precision@K: fraction of the top-K hits that are correct.
 * If fewer than K hits are returned, divides by actual count (not K),
 * so a variant returning 2 correct hits out of 2 scores 1.0, not 0.4.
 */
export function precisionAtK(hits, expected, k = 5) {
  const top = hits.slice(0, k);
  if (top.length === 0) return 0;
  const correct = top.filter(h => matches(h, expected)).length;
  return correct / top.length;
}

/**
 * Recall@K: fraction of expected entries hit by at least one top-K hit.
 * Counts distinct expected entries matched (so two hits in the same expected
 * book/range count as one).
 */
export function recallAtK(hits, expected, k = 5) {
  if (expected.length === 0) return 1; // nothing to recall = perfect
  const top = hits.slice(0, k);
  const matchedExpected = expected.filter(e =>
    top.some(h => matches(h, [e])),
  );
  return matchedExpected.length / expected.length;
}

/**
 * Mean Reciprocal Rank: 1 / rank of the first correct hit, 0 if none in top 20.
 * A single-query MRR is just the reciprocal rank; the "mean" applies across the
 * query set in the runner.
 */
export function reciprocalRank(hits, expected, maxRank = 20) {
  for (let i = 0; i < Math.min(hits.length, maxRank); i++) {
    if (matches(hits[i], expected)) return 1 / (i + 1);
  }
  return 0;
}

/** Aggregate per-variant metrics across a query set. */
export function aggregate(perQueryResults) {
  if (perQueryResults.length === 0) {
    return { p5: 0, r5: 0, mrr: 0, p1: 0, count: 0 };
  }
  const sum = (key) => perQueryResults.reduce((s, r) => s + r[key], 0);
  return {
    count: perQueryResults.length,
    p1: sum('p1') / perQueryResults.length,
    p5: sum('p5') / perQueryResults.length,
    r5: sum('r5') / perQueryResults.length,
    mrr: sum('mrr') / perQueryResults.length,
    avgLatencyMs: sum('latencyMs') / perQueryResults.length,
  };
}
