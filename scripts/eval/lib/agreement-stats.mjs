// Agreement and screening statistics for small labelled samples: Wilson intervals,
// chance-corrected agreement (Cohen's kappa, weighted kappa, Gwet's AC1), a rank AUC,
// and the sample size a Wilson interval needs.
//
// PRIOR ART: lib/paired-stats.mjs — bootstrap and paired-difference intervals, no
// proportion intervals or agreement coefficients; ft-reliability-report.ts computes a
// 3-class Cohen's kappa inline (not exported). src/app/research/quality/page.tsx has a
// page-local wilson(); this is the same formula for scripts.

const Z95 = 1.959964;

/** Wilson score interval (Wilson 1927) for k successes in n. Returns [lo, hi]. */
export function wilson(k, n, z = Z95) {
  if (!n) return [0, 1];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

/** Half-width of the Wilson interval at proportion p and size n. */
export function wilsonHalfWidth(p, n, z = Z95) {
  const k = Math.round(p * n);
  const [lo, hi] = wilson(k, n, z);
  return (hi - lo) / 2;
}

/** Smallest n whose Wilson interval at proportion p has half-width ≤ h. */
export function nForHalfWidth(p, h, z = Z95) {
  for (let n = 2; n < 100000; n++) if (wilsonHalfWidth(p, n, z) <= h) return n;
  return Infinity;
}

/** Cohen's kappa and Gwet's AC1 for two binary ratings per item: pairs of [bool, bool]. */
export function binaryAgreement(pairs) {
  const n = pairs.length;
  const po = pairs.filter(([a, b]) => a === b).length / n;
  const pa = pairs.filter(([a]) => a).length / n;
  const pb = pairs.filter(([, b]) => b).length / n;
  const pe = pa * pb + (1 - pa) * (1 - pb);
  const pi = (pa + pb) / 2;
  const pe1 = 2 * pi * (1 - pi);
  return { n, observed: po, kappa: (po - pe) / (1 - pe), ac1: (po - pe1) / (1 - pe1), positive_a: pa, positive_b: pb };
}

/**
 * Weighted kappa for ordinal ratings 1..K: pairs of [a, b]. weights 'quadratic' (default)
 * or 'linear'. Quadratic weighting is the usual choice for a 1–5 scale.
 */
export function weightedKappa(pairs, K = 5, weights = 'quadratic') {
  const n = pairs.length;
  const O = Array.from({ length: K }, () => new Array(K).fill(0));
  for (const [a, b] of pairs) O[a - 1][b - 1]++;
  const row = O.map((r) => r.reduce((s, x) => s + x, 0));
  const col = O[0].map((_, j) => O.reduce((s, r) => s + r[j], 0));
  const w = (i, j) => (weights === 'linear' ? Math.abs(i - j) / (K - 1) : ((i - j) ** 2) / ((K - 1) ** 2));
  let num = 0, den = 0;
  for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) {
    num += w(i, j) * O[i][j];
    den += (w(i, j) * row[i] * col[j]) / n;
  }
  return 1 - num / den;
}

/**
 * Area under the ROC curve by Mann–Whitney: the probability that a random positive
 * scores LOWER than a random negative (lower score = more suspicious), ties count half.
 */
export function aucLowerIsPositive(rows, score = (r) => r.score, isPos = (r) => r.positive) {
  const pos = rows.filter(isPos).map(score);
  const neg = rows.filter((r) => !isPos(r)).map(score);
  let c = 0;
  for (const p of pos) for (const q of neg) c += p < q ? 1 : p === q ? 0.5 : 0;
  return c / (pos.length * neg.length);
}

/** Percentile bootstrap over items: stat(resample) → number; returns [lo, hi] at 95%. */
export function bootstrapItems(items, stat, rng, iters = 2000) {
  const xs = [];
  for (let t = 0; t < iters; t++) {
    const s = items.map(() => items[Math.floor(rng() * items.length)]);
    const v = stat(s);
    if (Number.isFinite(v)) xs.push(v);
  }
  xs.sort((a, b) => a - b);
  return [xs[Math.floor(0.025 * xs.length)], xs[Math.floor(0.975 * xs.length) - 1]];
}
