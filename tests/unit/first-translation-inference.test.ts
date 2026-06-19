import { describe, it, expect } from 'vitest';
import {
  wilsonInterval,
  estimateCorpus,
  suggestSampleSize,
  Z_95,
} from '@/lib/first-translation/inference';

describe('wilsonInterval', () => {
  it('matches the known Wilson value for 0.5 at n=96 (~±0.10)', () => {
    const [lo, hi] = wilsonInterval(48, 96);
    expect((hi - lo) / 2).toBeCloseTo(0.0985, 2);
    expect((lo + hi) / 2).toBeCloseTo(0.5, 5);
  });

  it('handles the zero-success edge without going negative', () => {
    const [lo, hi] = wilsonInterval(0, 50);
    expect(lo).toBeCloseTo(0, 10);
    expect(hi).toBeGreaterThan(0);
    expect(hi).toBeLessThan(0.1);
  });

  it('handles all-successes without exceeding 1', () => {
    const [, hi] = wilsonInterval(50, 50);
    expect(hi).toBe(1);
  });

  it('returns the full [0,1] for n=0', () => {
    expect(wilsonInterval(0, 0)).toEqual([0, 1]);
  });

  it('widens as n shrinks', () => {
    const wide = wilsonInterval(5, 10);
    const narrow = wilsonInterval(50, 100);
    expect(wide[1] - wide[0]).toBeGreaterThan(narrow[1] - narrow[0]);
  });
});

describe('estimateCorpus', () => {
  it('corrects each stratum by its measured false-first rate', () => {
    // Western: 0% false-first; non-Western canonical: 50% false-first.
    const est = estimateCorpus([
      { key: 'western', size: 4000, sampled: 50, falseFirsts: 0 },
      { key: 'nonwestern-canonical', size: 800, sampled: 50, falseFirsts: 25 },
    ]);
    expect(est.rawTotal).toBe(4800);
    // 4000*(1-0) + 800*(1-0.5) = 4000 + 400 = 4400
    expect(est.estimatedFirsts).toBeCloseTo(4400, 5);
    expect(est.ciHalfWidth).toBeGreaterThan(0);
    expect(est.ci[0]).toBeLessThan(4400);
    expect(est.ci[1]).toBeGreaterThan(4400);
  });

  it('a perfectly-clean fully-sampled stratum has zero variance', () => {
    const est = estimateCorpus([{ key: 'all', size: 100, sampled: 100, falseFirsts: 0 }]);
    expect(est.estimatedFirsts).toBe(100);
    expect(est.ciHalfWidth).toBe(0); // FPC -> 0 when n==N
  });

  it('an unsampled stratum counts at face value and adds no variance', () => {
    const est = estimateCorpus([{ key: 'unmeasured', size: 500, sampled: 0, falseFirsts: 0 }]);
    expect(est.estimatedFirsts).toBe(500);
    expect(est.ciHalfWidth).toBe(0);
  });

  it('higher false-first rate lowers the estimate', () => {
    const low = estimateCorpus([{ key: 's', size: 1000, sampled: 50, falseFirsts: 5 }]);
    const high = estimateCorpus([{ key: 's', size: 1000, sampled: 50, falseFirsts: 40 }]);
    expect(high.estimatedFirsts).toBeLessThan(low.estimatedFirsts);
  });
});

describe('suggestSampleSize', () => {
  it('targets ~96 for a large stratum at ±0.10', () => {
    expect(suggestSampleSize(100000, 0.1)).toBeGreaterThanOrEqual(95);
    expect(suggestSampleSize(100000, 0.1)).toBeLessThanOrEqual(97);
  });

  it('never exceeds the stratum size', () => {
    expect(suggestSampleSize(30, 0.1)).toBeLessThanOrEqual(30);
  });

  it('a tighter target needs a bigger sample', () => {
    expect(suggestSampleSize(100000, 0.05)).toBeGreaterThan(suggestSampleSize(100000, 0.1));
  });
});
