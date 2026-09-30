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
 * `stats-cross-model.mjs` still carries its own copies of the three tests;
 * migrating it to import them from here is a separate change (one concern per
 * PR). It does draw from this module's generator (`makeRng`), so there is one
 * PRNG to get right. If you fix a bug in a test here, fix it there too.
 *
 * The bootstrap PRNG is seeded so a CI is reproducible across runs — a
 * confidence interval that moves when you re-run the report is not auditable.
 *
 * THE GENERATOR (#5373). Until 2026-09-30 this was the C-library LCG
 * `seed = (seed * 1103515245 + 12345) & 0x7fffffff`, written in double
 * arithmetic. The product passes 2^53, so the low bits were rounded away
 * BEFORE the mask kept exactly those bits, and the stream fell onto a short
 * cycle: 13,676 distinct values in 1,000,000 draws. A 10,000-resample bootstrap
 * went round it hundreds of times, so intervals came out the wrong width. It is
 * now mulberry32, whose every step stays inside 32-bit integer arithmetic
 * (`Math.imul`, `>>> 0`); period 2^32. `tests/unit/paired-stats-prng.test.ts`
 * pins distinctness and uniformity.
 *
 * A seed therefore no longer yields the stream it did before that date. To
 * REPRODUCE a draw, a blinded packet or an interval made earlier, run the
 * harness with `PAIRED_STATS_LEGACY_LCG=1`; never use it for a new result.
 */

/**
 * A seeded uniform generator on [0, 1): mulberry32. Use this, not a hand-rolled
 * LCG, when a script needs its own stream independent of `resetSeed`.
 */
export function makeRng(s = 0x5eed) {
  let state = s >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The pre-#5373 generator, kept only so an old artifact can be reproduced. */
function makeLegacyLcg(s) {
  let seed = s;
  return () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000;
}

const LEGACY = process.env.PAIRED_STATS_LEGACY_LCG === '1';
if (LEGACY) console.error('paired-stats: PAIRED_STATS_LEGACY_LCG=1 — using the pre-#5373 generator (short cycle); for reproducing old artifacts only');
const newStream = (s) => (LEGACY ? makeLegacyLcg(s) : makeRng(s));

let rand = newStream(0x5eed);
export const resetSeed = (s = 0x5eed) => { rand = newStream(s); };

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

/**
 * The module's seeded PRNG, exported so a harness that needs a reproducible
 * SHUFFLE (blinding a judge packet, picking a subsample) draws from the same
 * stream `resetSeed` controls instead of `Math.random`, which would make the
 * artifact different on every run and therefore unauditable.
 */
export const seededRand = () => rand();

/**
 * Bootstrap 95% CI on a RATIO of two per-unit counts (e.g. verified notes /
 * notes emitted), resampling the UNITS — pages — not the numerator events.
 *
 * Why it belongs here rather than in a harness: a rate whose denominator is
 * itself random (a page emits 0, 1 or 7 notes) has a CI that a plain binomial
 * interval understates, because the notes inside one page are not independent
 * draws. Resampling pages is the cluster bootstrap that fixes it, and it is the
 * shape every "rate over pages" outcome in this repo has.
 *
 * @param {number[]} nums per-unit numerators
 * @param {number[]} dens per-unit denominators (same length)
 * @returns {{rate: number|null, ci: [number, number]|null, units: number, denom: number}}
 */
export function bootstrapRatioCI(nums, dens, iters = 10000) {
  const units = nums.length;
  const denom = dens.reduce((s, x) => s + x, 0);
  if (!units || !denom) return { rate: null, ci: null, units, denom };
  const rate = nums.reduce((s, x) => s + x, 0) / denom;
  const out = [];
  for (let i = 0; i < iters; i++) {
    let a = 0, b = 0;
    for (let j = 0; j < units; j++) { const k = Math.floor(rand() * units); a += nums[k]; b += dens[k]; }
    if (b) out.push(a / b);
  }
  if (out.length < 2) return { rate, ci: null, units, denom };
  out.sort((x, y) => x - y);
  return { rate, ci: [out[Math.floor(out.length * 0.025)], out[Math.floor(out.length * 0.975)]], units, denom };
}
