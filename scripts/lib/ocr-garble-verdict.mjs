// PRIOR ART: scripts/lib/ocr-garble-score.mjs computes the features; scripts/lib/ocr-loop-guard.mjs
// owns the exact-loop refusal at write time. This file only turns features into a verdict, so
// thresholds can change without re-walking the corpus.
/**
 * ocr-garble-verdict — is this page's OCR garbled? (#5313)
 *
 * A feature is read against the corpus distribution for the page's catalogue LANGUAGE (falling
 * back to its script), never against a global constant: a clean Sanskrit commentary misses the
 * lexicon far more often than a clean German novel, and a fixed OOV cut would flag every page of
 * the first and none of the second.
 *
 * Thresholds were fixed on the #5274 audit's judged pages; see EXPERIMENTS.md for the P/R and
 * the caveat that the reference set is also the tuning set.
 */

export const VERDICT_VERSION = 'garble-verdict@1';

export const THRESHOLDS = {
  /** OOV rate must exceed this quantile of the page's language (or script) distribution … */
  oov_quantile: 'p98',
  /** … and exceed that language's MEDIAN by at least this much (absolute). */
  oov_margin: 0.2,
  /** Filler: one unit making up this share of the page at >= 10x its corpus rate. */
  filler: 0.08,
  /** Non-periodic repeated 5-grams covering this share of the page (taxonomy O4). */
  repeat: 0.35,
  /** Exact periodic loop share (ocr-loop-guard's own gate is 0.5; 0.3 is its "partial" band). */
  loop: 0.3,
};

/** Features whose corpus distribution is recorded per group (see ocr-garble-corpus.mjs). */
export const BASELINE_FEATURES = ['oov', 'oov_lang', 'no_vowel', 'mixed', 'fragment', 'filler', 'repeat'];

/** The distribution to judge a page against: its language, else its script, else none. */
export function baselineFor(baselines, row) {
  const g = baselines?.groups || {};
  return g[`language:${String(row.language || '').trim().toLowerCase()}`] || g[`script:${row.script}`] || null;
}

/**
 * @param row       features from garbleFeatures() (plus `language`)
 * @param baseline  the group from baselineFor(), or null
 * @returns {{garbled: boolean, reasons: string[], score: number|null}}
 *   `score` is the page's OOV rate minus its group median (null when there is no baseline).
 */
export function garbleVerdict(row, baseline, t = THRESHOLDS) {
  const reasons = [];
  let score = null;
  if (row.judged === false) return { garbled: false, reasons, score };
  const q = baseline?.oov;
  if (q && row.oov != null) {
    score = +(row.oov - q.p50).toFixed(4);
    if (row.oov > q[t.oov_quantile] && score >= t.oov_margin) reasons.push('oov');
  }
  if ((row.filler || 0) >= t.filler) reasons.push('filler');
  if ((row.repeat || 0) >= t.repeat) reasons.push('repeat');
  if ((row.loop || 0) >= t.loop) reasons.push('loop');
  return { garbled: reasons.length > 0, reasons, score };
}
