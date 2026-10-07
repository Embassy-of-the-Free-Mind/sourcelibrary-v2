// PRIOR ART: scripts/import/ia-ocr-ingest.mjs scores reference pages at every leaf offset in ±3 with
// `ratio()` (LCS, O(n²) per pair) and takes a BOOK-level vote — it cannot say which pages moved, and
// at ±8 over every page of a book the LCS is too slow. hetzner:/root/sl-ia-cache/_runs/pipeline-safe/
// model-text-alignment.hetzner.mjs (#4790, uncommitted) used a bag-of-words Dice at offsets −2…+1 on
// the 197 held books; neighbouring pages of one book share most of their vocabulary, so a unigram
// bag separates leaves weakly. scripts/lib/ia-ocr-agreement.mjs — the tokenizer reused here.
//
// leaf-offset-match — which of a run of candidate leaves is a page's text a reading of? (#5309)
//
// THE SCORE is Dice over token-BIGRAM multisets: order-local, linear, and near zero between two
// different pages of the same book (they share words, not word pairs). It identifies a leaf; it is
// not a quality score — a fixed-position omission or a garbled line moves it little, by design.
//
// THE DECISION is per page and can abstain: the best offset must clear `minScore` AND beat the
// runner-up by `minMargin`. A page that matches nothing (the Archive's engine read junk, a plate,
// another script) is `low`; one that matches two leaves equally (a rescanned duplicate leaf,
// boilerplate) is `ambiguous`. Neither is ever counted as aligned or as shifted.

/** Token list → Map(bigram → count), with `.total` = number of bigrams. */
export function bigramCounts(tok) {
  const m = new Map(); let total = 0;
  for (let i = 0; i + 1 < tok.length; i++) { const g = `${tok[i]} ${tok[i + 1]}`; m.set(g, (m.get(g) || 0) + 1); total++; }
  m.total = total;
  return m;
}

/** Dice coefficient of two bigram multisets: 2·|A∩B| / (|A|+|B|). */
export function dice(a, b) {
  if (!a.total || !b.total) return 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let hit = 0;
  for (const [g, n] of small) { const o = big.get(g); if (o) hit += Math.min(n, o); }
  return (2 * hit) / (a.total + b.total);
}

export const DEFAULTS = { window: 8, minScore: 0.3, minMargin: 0.15, minTokens: 40, farMinScore: 0.5 };

/**
 * Where does a page's text sit relative to leaf `k`?
 * @param {Map} page        bigramCounts of the page's text
 * @param {Array<Map|null>} leaves  bigramCounts per leaf; null = the leaf carries too little text to compare
 * @returns {{verdict: 'aligned'|'shifted'|'far'|'low'|'ambiguous'|'no_leaf_text', offset: number|null, score: number, score0: number|null, second: number}}
 *   `shifted` = best leaf is within ±window and not k; `far` = nothing in the window matched but a
 *   leaf elsewhere in the item does (reported separately — a different defect from a run-wise shift).
 */
export function pageOffset(page, leaves, k, opts = {}) {
  const { window, minScore, minMargin, farMinScore } = { ...DEFAULTS, ...opts };
  const scoreAt = (j) => (j >= 0 && j < leaves.length && leaves[j] ? dice(page, leaves[j]) : null);
  const rank = (lo, hi) => {
    let best = null, second = 0;
    for (let j = lo; j <= hi; j++) {
      const s = scoreAt(j); if (s === null) continue;
      if (!best || s > best.s) { if (best) second = Math.max(second, best.s); best = { j, s }; } else second = Math.max(second, s);
    }
    return { best, second };
  };
  const score0 = scoreAt(k);
  const near = rank(k - window, k + window);
  if (!near.best) return { verdict: 'no_leaf_text', offset: null, score: 0, score0, second: 0 };
  if (near.best.s >= minScore) {
    if (near.best.s - near.second < minMargin) return { verdict: 'ambiguous', offset: null, score: near.best.s, score0, second: near.second };
    const offset = near.best.j - k;
    return { verdict: offset === 0 ? 'aligned' : 'shifted', offset, score: near.best.s, score0, second: near.second };
  }
  const all = rank(0, leaves.length - 1);
  if (all.best && all.best.s >= farMinScore && all.best.s - all.second >= minMargin) return { verdict: 'far', offset: all.best.j - k, score: all.best.s, score0, second: all.second };
  return { verdict: 'low', offset: null, score: near.best.s, score0, second: near.second };
}

/**
 * Contiguous runs of shifted pages. `rows` are one book's compared pages in reading order, each
 * `{ page_number, verdict, offset }`. A run is a maximal stretch of `shifted` pages sharing ONE
 * offset; pages that abstained (`low`, `ambiguous`, `no_leaf_text`) inside it do not break it and
 * are counted in `span` (they sit between two pages known to be shifted the same way), but an
 * `aligned` page, a `far` page or a different offset does.
 * @returns {Array<{from: number, to: number, offset: number, decided: number, span: number}>}
 */
export function shiftRuns(rows) {
  const runs = []; let cur = null, pending = 0;
  const close = () => { if (cur) runs.push(cur); cur = null; pending = 0; };
  for (const r of rows) {
    if (r.verdict === 'shifted') {
      if (cur && cur.offset === r.offset) { cur.to = r.page_number; cur.decided++; cur.span += pending + 1; pending = 0; }
      else { close(); cur = { from: r.page_number, to: r.page_number, offset: r.offset, decided: 1, span: 1 }; }
    } else if (r.verdict === 'aligned' || r.verdict === 'far') close();
    else if (cur) pending++;
  }
  close();
  return runs;
}
