// PRIOR ART: none — searched scripts/eval/lib and scripts/lib for "logistic", "softmax", "logreg";
// the repo has no in-process classifier and no Python ML stack on the box (no sklearn).
//
// Multinomial logistic regression (softmax) over dense float vectors, full-batch gradient descent
// with L2. Small and deterministic: enough for 512-d CLIP vectors and a few classes (#5768).

/** Standardise columns; returns {mean, std} to apply to new rows. */
export function fitScaler(X) {
  const d = X[0].length, n = X.length;
  const mean = new Float64Array(d), std = new Float64Array(d);
  for (const x of X) for (let j = 0; j < d; j++) mean[j] += x[j] / n;
  for (const x of X) for (let j = 0; j < d; j++) std[j] += (x[j] - mean[j]) ** 2 / n;
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j]) || 1;
  return { mean: [...mean], std: [...std] };
}
export const scale = (x, s) => x.map((v, j) => (v - s.mean[j]) / s.std[j]);

/**
 * @param {number[][]} X  scaled rows
 * @param {number[]} y    class index per row
 * @param {{classes:number, epochs?:number, lr?:number, l2?:number, weights?:number[]}} o  weights: per-class loss weight
 */
export function fitLogReg(X, y, { classes, epochs = 300, lr = 0.5, l2 = 1e-3, weights = null }) {
  const d = X[0].length, n = X.length;
  const W = Array.from({ length: classes }, () => new Float64Array(d + 1));
  const cw = weights || Array(classes).fill(1);
  const p = new Float64Array(classes);
  for (let ep = 0; ep < epochs; ep++) {
    const G = Array.from({ length: classes }, () => new Float64Array(d + 1));
    let wsum = 0;
    for (let i = 0; i < n; i++) {
      const x = X[i];
      let mx = -Infinity;
      for (let k = 0; k < classes; k++) { let z = W[k][d]; const w = W[k]; for (let j = 0; j < d; j++) z += w[j] * x[j]; p[k] = z; if (z > mx) mx = z; }
      let s = 0; for (let k = 0; k < classes; k++) { p[k] = Math.exp(p[k] - mx); s += p[k]; }
      const iw = cw[y[i]]; wsum += iw;
      for (let k = 0; k < classes; k++) {
        const g = (p[k] / s - (y[i] === k ? 1 : 0)) * iw;
        if (g === 0) continue;
        const Gk = G[k]; for (let j = 0; j < d; j++) Gk[j] += g * x[j]; Gk[d] += g;
      }
    }
    for (let k = 0; k < classes; k++) for (let j = 0; j <= d; j++) W[k][j] -= lr * (G[k][j] / wsum + (j < d ? l2 * W[k][j] : 0));
  }
  return { W: W.map((w) => [...w]), classes };
}

export function predictProba(model, x) {
  const d = x.length;
  const z = model.W.map((w) => { let s = w[d]; for (let j = 0; j < d; j++) s += w[j] * x[j]; return s; });
  const mx = Math.max(...z); const e = z.map((v) => Math.exp(v - mx)); const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}
