/**
 * Reciprocal Rank Fusion (Cormack/Clarke/Buettcher 2009).
 *
 * Fuses several independently-ranked lists of item keys into one combined
 * ranking. Each list is an ordered array of keys, best-first. An item's fused
 * score is the sum, over every list it appears in, of `1 / (k + rank)` where
 * `rank` is its 0-based position in that list. Items absent from a list
 * contribute nothing from it, so an item that ranks well in several lists
 * outscores one that ranks well in only a single list.
 *
 * `k` (default 60, the canonical value) dampens the contribution of top ranks
 * so the curve isn't dominated by rank-0. On Source Library's Librarian eval,
 * k=20 and k=60 produced identical orderings — 60 is kept for posterity.
 *
 * The function is pure and key-agnostic: callers pick the key scheme (book id,
 * `${book_id}-p${page_number}`, etc.) so the same util fuses book-level and
 * page-level lanes side by side.
 */
export function rrfScores(rankedLists: string[][], k = 60): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of rankedLists) {
    // Dedupe within a single list so a lane that emits the same key twice
    // can't double-count it; only the best (first) position contributes.
    const seen = new Set<string>();
    let rank = 0;
    for (const key of list) {
      if (key == null || seen.has(key)) continue;
      seen.add(key);
      scores.set(key, (scores.get(key) ?? 0) + 1 / (k + rank + 1));
      rank++;
    }
  }
  return scores;
}
