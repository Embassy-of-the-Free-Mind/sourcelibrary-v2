/**
 * Paired / two-sample statistics for eval harnesses.
 *
 * PROVENANCE: lifted verbatim in method from `scripts/eval/stats-cross-model.mjs`
 * (#3235), which has used these three tests on paired per-page deltas since
 * 2026-07. Extracted here so a second harness does not hand-roll a weaker rule —
 * `prompt-ab.mjs` originally compared arm means against a pooled SD, which is an
 * ad-hoc threshold with no error rate attached, while this machinery was already
 * in the repo.
 *
 * `stats-cross-model.mjs` still carries its own copies; migrating it to import
 * from here is a separate change (one concern per PR) and is the obvious
 * follow-up. Until then, if you fix a bug here, fix it there too.
 *
 * The bootstrap PRNG is seeded so a CI is reproducible across runs — a
 * confidence interval that moves when you re-run the report is not auditable.
 */

let seed = 0x5eed;
export const resetSeed = (s = 0x5eed) => { seed = s; };
const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000;

export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

/** Exact two-sided sign test: 2 * P(X <= min(k, n-k)), capped at 1. */
export function binomTwoSided(k, n) {
  if (!n) return 1;
  const logC = (nn, kk) => { let s = 0; for (let i = 0; i < kk; i++) s += Math.log(nn - i) - Math.log(i + 1); return s; };
  const lo = Math.min(k, n - k);
  let p = 0;
  for (let i = 0; i <= lo; i++) p += Math.exp(logC(n, i) - n * Math.LN2);
  return Math.min(1, 2 * p);
}

/** 10k-resample bootstrap 95% CI on the mean of `xs`. */
export function bootstrapCI(xs, iters = 10000) {
  if (xs.length < 2) return null;
  const means = [];
  for (let i = 0; i < iters; i++) {
    let s = 0;
    for (let j = 0; j < xs.length; j++) s += xs[Math.floor(rand() * xs.length)];
    means.push(s / xs.length);
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(iters * 0.025)], means[Math.floor(iters * 0.975)]];
}

/**
 * Bootstrap 95% CI on the DIFFERENCE OF MEANS between two independent samples
 * (the k runs of arm A vs the k runs of arm B on ONE page). Resamples each arm
 * independently, which is the correct structure here: the runs are independent
 * draws from each arm's sampler, not paired with each other.
 *
 * Returns { delta, ci, decisive } — `decisive` is true when the CI excludes 0,
 * which is the criterion that replaces the old "bigger than the pooled SD".
 */
export function diffCI(armA, armB, iters = 10000) {
  if (armA.length < 2 || armB.length < 2) return null;
  const delta = mean(armB) - mean(armA);
  const diffs = [];
  for (let i = 0; i < iters; i++) {
    let sa = 0; for (let j = 0; j < armA.length; j++) sa += armA[Math.floor(rand() * armA.length)];
    let sb = 0; for (let j = 0; j < armB.length; j++) sb += armB[Math.floor(rand() * armB.length)];
    diffs.push(sb / armB.length - sa / armA.length);
  }
  diffs.sort((a, b) => a - b);
  const ci = [diffs[Math.floor(iters * 0.025)], diffs[Math.floor(iters * 0.975)]];
  return { delta, ci, decisive: (ci[0] > 0 && ci[1] > 0) || (ci[0] < 0 && ci[1] < 0) };
}
