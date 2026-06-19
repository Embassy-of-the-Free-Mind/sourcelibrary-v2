/**
 * Stratified-sample inference for the first-translation corpus estimate (#2564).
 *
 * We cannot Tier-2 ground-truth all ~6,900 public firsts. Instead: stratify,
 * draw a random sample per stratum, Tier-2 the sample to measure each stratum's
 * FALSE-FIRST rate, then infer the corrected corpus count with a confidence
 * interval — a defensible "N ± M first translations" instead of a stale 5,732.
 *
 * Pure math, no I/O — unit-tested.
 */

/** z for a 95% two-sided interval. */
export const Z_95 = 1.959963984540054;

/** Observed sample for one stratum. */
export interface StratumSample {
  key: string;
  /** Total public-first books in this stratum (population size N_h). */
  size: number;
  /** Books Tier-2 ground-truthed in this stratum (sample size n_h). */
  sampled: number;
  /** Of the sampled, how many turned out NOT to be a genuine first (false-first). */
  falseFirsts: number;
}

export interface StratumEstimate extends StratumSample {
  /** Measured false-first rate p̂_h. */
  falseRate: number;
  /** Wilson 95% CI for the false-first rate. */
  falseRateCI: [number, number];
  /** Estimated genuine firsts in this stratum = N_h·(1−p̂_h). */
  correctedFirsts: number;
  /** Sampling variance of correctedFirsts (with finite-population correction). */
  variance: number;
}

export interface CorpusEstimate {
  strata: StratumEstimate[];
  /** Σ stratum sizes (the raw, un-corrected public-first count). */
  rawTotal: number;
  /** Point estimate of genuine firsts Σ N_h·(1−p̂_h). */
  estimatedFirsts: number;
  /** 95% half-width: estimatedFirsts ± ciHalfWidth. */
  ciHalfWidth: number;
  /** Convenience: [low, high]. */
  ci: [number, number];
}

/**
 * Wilson score interval for a binomial proportion. Robust at small n and
 * extreme p (where the normal approximation breaks).
 */
export function wilsonInterval(successes: number, n: number, z = Z_95): [number, number] {
  if (n <= 0) return [0, 1];
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

/**
 * Estimate the corpus count of genuine first translations from per-stratum
 * Tier-2 samples. Uses the standard stratified estimator with a finite-
 * population correction (strata are finite and samples are without replacement).
 *
 * A stratum with sampled=0 contributes its full size as "unmeasured" — its
 * books are counted at face value (rate 0) but add no variance reduction;
 * surface those separately so the estimate isn't silently optimistic.
 */
export function estimateCorpus(samples: StratumSample[], z = Z_95): CorpusEstimate {
  const strata: StratumEstimate[] = samples.map((s) => {
    const n = s.sampled;
    const N = s.size;
    const p = n > 0 ? s.falseFirsts / n : 0;
    const ci = wilsonInterval(s.falseFirsts, n, z);
    const correctedFirsts = N * (1 - p);
    // Var(N·(1−p̂)) = N² · Var(p̂); Var(p̂) with FPC.
    let variance = 0;
    if (n > 1 && N > 0) {
      const fpc = (N - n) / N; // finite-population correction
      variance = N * N * ((p * (1 - p)) / (n - 1)) * fpc;
    }
    return { ...s, falseRate: p, falseRateCI: ci, correctedFirsts, variance };
  });

  const rawTotal = strata.reduce((a, s) => a + s.size, 0);
  const estimatedFirsts = strata.reduce((a, s) => a + s.correctedFirsts, 0);
  const totalVar = strata.reduce((a, s) => a + s.variance, 0);
  const ciHalfWidth = z * Math.sqrt(totalVar);
  return {
    strata,
    rawTotal,
    estimatedFirsts,
    ciHalfWidth,
    ci: [Math.max(0, estimatedFirsts - ciHalfWidth), estimatedFirsts + ciHalfWidth],
  };
}

/**
 * Suggested sample size per stratum for a target Wilson half-width at the
 * worst case p=0.5 (FPC-adjusted). Caps at the stratum size.
 */
export function suggestSampleSize(stratumSize: number, targetHalfWidth = 0.1, z = Z_95): number {
  const p = 0.5;
  const n0 = (z * z * p * (1 - p)) / (targetHalfWidth * targetHalfWidth);
  const n = n0 / (1 + (n0 - 1) / stratumSize); // FPC-adjusted
  return Math.min(stratumSize, Math.ceil(n));
}
