// Agreement and screening statistics for small labelled samples: Wilson intervals,
// chance-corrected agreement (Cohen's kappa, weighted kappa, Gwet's AC1, Krippendorff's alpha and the
// judge-reliability verdict every two-judge run reports), a rank AUC,
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

/**
 * Krippendorff's alpha (Krippendorff 2011). units: array of arrays of values (one per reader; null/undefined =
 * missing). level: 'nominal' | 'ordinal' | 'interval'. Units with fewer than two values are not pairable and are
 * dropped. Moved here from scripts/eval/second-reader/lib.mjs (#6338), unchanged.
 */
export function krippendorffAlpha(units, level = 'nominal') {
  const vals = units.map((u) => u.filter((v) => v !== null && v !== undefined)).filter((u) => u.length >= 2);
  if (!vals.length) return null;
  const cats = [...new Set(vals.flat())].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const ix = new Map(cats.map((c, i) => [c, i]));
  const K = cats.length, o = Array.from({ length: K }, () => new Array(K).fill(0));
  for (const u of vals) {
    const m = u.length;
    for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) if (i !== j) o[ix.get(u[i])][ix.get(u[j])] += 1 / (m - 1);
  }
  const nc = o.map((row) => row.reduce((s, x) => s + x, 0)), n = nc.reduce((s, x) => s + x, 0);
  const d2 = (c, k) => {
    if (level === 'nominal') return c === k ? 0 : 1;
    if (level === 'interval') return (cats[c] - cats[k]) ** 2;
    const [lo, hi] = c < k ? [c, k] : [k, c];
    let s = 0; for (let g = lo; g <= hi; g++) s += nc[g];
    return (s - (nc[c] + nc[k]) / 2) ** 2;
  };
  let Do = 0, De = 0;
  for (let c = 0; c < K; c++) for (let k = 0; k < K; k++) { const d = d2(c, k); Do += o[c][k] * d; De += nc[c] * nc[k] * d; }
  Do /= n; De /= n * (n - 1);
  return De === 0 ? null : 1 - Do / De;
}

/** Krippendorff's conventional cut-offs: ≥ 0.800 reliable, ≥ 0.667 tentative, below that the measure is not settled. */
export const ALPHA_RELIABLE = 0.8;
export const ALPHA_TENTATIVE = 0.667;

/**
 * Judge reliability for one judged measure (eval-design.md §2, "Judge agreement"): alpha, a 95% bootstrap interval
 * over units, and a verdict word. Bootstrap by BOOK when units carry a cluster key (pages of one book are one
 * observation): units as [{ cluster, values }] or plain arrays of values.
 */
export function judgeReliability(units, { level = 'nominal', rng, iters = 2000 } = {}) {
  const rows = units.map((u) => (Array.isArray(u) ? { cluster: null, values: u } : u));
  const paired = rows.filter((r) => r.values.filter((v) => v !== null && v !== undefined).length >= 2);
  const alpha = krippendorffAlpha(paired.map((r) => r.values), level);
  let ci = null;
  if (alpha !== null && rng) {
    const groups = new Map();
    paired.forEach((r, i) => { const k = r.cluster ?? `u${i}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r.values); });
    const gs = [...groups.values()];
    ci = bootstrapItems(gs, (s) => krippendorffAlpha(s.flat(), level), rng, iters);
  }
  const verdict = alpha === null ? 'no pairable units' : alpha >= ALPHA_RELIABLE ? 'reliable' : alpha >= ALPHA_TENTATIVE ? 'tentative' : 'not settled';
  return { alpha, ci, n_units: paired.length, level, verdict };
}

/** One printable line: `serious (nominal): α 0.02 [−0.20, 0.25], 16 pages — not settled`. */
export function reliabilityLine(name, r, unit = 'pages') {
  const f = (x) => (x == null ? '—' : x.toFixed(2).replace('-', '−'));
  const ci = r.ci ? ` [${f(r.ci[0])}, ${f(r.ci[1])}]` : '';
  return `${name} (${r.level}): α ${f(r.alpha)}${ci}, ${r.n_units} ${unit} — ${r.verdict}`;
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
