// #6740 read-surface, STEER 1: the Bayesian surface. A full quadratic in the three coded factors, fitted to run means
// with their by-book bootstrap variances; earlier results enter as power-prior points (variance ÷ a0); a0 is chosen by
// empirical Bayes from how well the earlier results agree with this design's own runs at the same settings; the next run
// is the one that most shrinks the posterior variance of the CER difference at the cheap end.
//
// PRIOR ART: fit.mjs (this directory: the same quadratic by least squares, no prior); scripts/eval/estimator/fit_prior.py
//   (a hierarchical prior over route cells, by language and family; no factors, no design). Nothing in the repo does
//   Bayesian sequential design.

export const terms = ([a, b, c]) => [1, a, b, c, a * b, a * c, b * c, a * a, b * b, c * c];
const K = 10;

function inv(M) {
  const n = M.length, A = M.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    const d = A[c][c]; for (let k = 0; k < 2 * n; k++) A[c][k] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c]; for (let k = 0; k < 2 * n; k++) A[r][k] -= f * A[c][k]; }
  }
  return A.map((r) => r.slice(n));
}
const quad = (g, S) => g.reduce((s, gi, i) => s + gi * S[i].reduce((t, sij, j) => t + sij * g[j], 0), 0);

/**
 * Posterior of β given points [{x, y, v}] (v = variance of y) and a vague N(0, tau²) prior on every coefficient
 * (intercept centred on m0). Returns { mean, cov }.
 */
export function posterior(points, { tau = 1, m0 = 0 } = {}) {
  const P = Array.from({ length: K }, (_, i) => Array.from({ length: K }, (_, j) => (i === j ? 1 / (tau * tau) : 0)));
  const b = Array.from({ length: K }, (_, i) => (i === 0 ? m0 / (tau * tau) : 0));
  for (const p of points) {
    const t = terms(p.x), w = 1 / p.v;
    for (let i = 0; i < K; i++) { b[i] += w * t[i] * p.y; for (let j = 0; j < K; j++) P[i][j] += w * t[i] * t[j]; }
  }
  const cov = inv(P);
  return { mean: cov.map((r) => r.reduce((s, c, j) => s + c * b[j], 0)), cov, precision: P };
}
export const predict = (post, x) => { const g = terms(x); return { mean: g.reduce((s, gi, i) => s + gi * post.mean[i], 0), sd: Math.sqrt(Math.max(0, quad(g, post.cov))) }; };

/**
 * Empirical-Bayes a0 for a power prior. pairs: [{ y0, v0, y1, v1 }] = an earlier result and this design's result at the
 * same setting. The marginal of y1 under the power prior is N(y0, v0 / a0 + v1); a0 in (0, 1] maximises the summed
 * log-likelihood (grid of 1,000). a0 = 1 when the two agree within their own noise; it falls as they disagree.
 */
export function estimateA0(pairs) {
  if (!pairs.length) return { a0: null, why: 'no setting has both an earlier and a new result' };
  let best = { a0: 1, ll: -Infinity };
  for (let k = 1; k <= 1000; k++) {
    const a0 = k / 1000;
    const ll = pairs.reduce((s, p) => { const v = p.v0 / a0 + p.v1; return s - 0.5 * Math.log(2 * Math.PI * v) - ((p.y1 - p.y0) ** 2) / (2 * v); }, 0);
    if (ll > best.ll) best = { a0, ll };
  }
  return best;
}

/**
 * The next run: among the candidate settings not yet run, the one whose addition (as a run mean with variance vRun) most
 * reduces the summed posterior variance of the CER difference between each cheap-end setting and live.
 * cheap: settings x (coded) at the cheap end; live: the coded point standing for live; returns candidates ranked.
 */
export function rankNext(post, candidates, cheap, live, vRun) {
  // live = null: live is measured, not on the surface (as here), so the difference's variance is the prediction's.
  const gl = live ? terms(live) : null;
  const dvec = (x) => (gl ? terms(x).map((t, i) => t - gl[i]) : terms(x));
  const total = (cov) => cheap.reduce((s, x) => s + quad(dvec(x), cov), 0);
  const base = total(post.cov);
  return candidates.map((c) => {
    const t = terms(c.x), P = post.precision.map((r, i) => r.map((v, j) => v + (t[i] * t[j]) / vRun));
    return { ...c, gain: base - total(inv(P)) };
  }).sort((a, b) => b.gain - a.gain);
}
