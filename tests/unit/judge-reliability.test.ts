/**
 * Judge reliability (eval-design.md §2, "Judge agreement"): Krippendorff's alpha now lives in
 * scripts/eval/lib/agreement-stats.mjs, and judgeReliability turns it into the verdict word a run prints.
 * Pins the cut-offs and that the re-export from second-reader/lib.mjs is the same function.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs helper, no types
import { krippendorffAlpha, judgeReliability, reliabilityLine } from '../../scripts/eval/lib/agreement-stats.mjs';
// @ts-expect-error — plain .mjs helper, no types
import { krippendorffAlpha as fromSecondReader } from '../../scripts/eval/second-reader/lib.mjs';
// @ts-expect-error — plain .mjs helper, no types
import { makeRng } from '../../scripts/eval/lib/paired-stats.mjs';

describe('judgeReliability', () => {
  it('second-reader still gets the same alpha', () => {
    expect(fromSecondReader).toBe(krippendorffAlpha);
  });

  it('two judges who always agree are reliable; who split at chance are not settled', () => {
    const same = Array.from({ length: 20 }, (_, i) => [i % 2, i % 2]);
    expect(judgeReliability(same).verdict).toBe('reliable');
    const chance = Array.from({ length: 40 }, (_, i) => [i % 2, Math.floor(i / 2) % 2]);
    const r = judgeReliability(chance);
    expect(r.alpha).toBeLessThan(0.1);
    expect(r.verdict).toBe('not settled');
  });

  it('drops units only one judge rated, and clusters the bootstrap by book', () => {
    const units = [
      { cluster: 'b1', values: [1, 1] }, { cluster: 'b1', values: [0, 0] },
      { cluster: 'b2', values: [1, 0] }, { cluster: 'b3', values: [1, null] },
      { cluster: 'b4', values: [0, 0] }, { cluster: 'b5', values: [1, 1] },
    ];
    const r = judgeReliability(units, { rng: makeRng(1), iters: 200 });
    expect(r.n_units).toBe(5);
    expect(r.ci).toHaveLength(2);
    expect(reliabilityLine('serious', r)).toMatch(/^serious \(nominal\): α \S+ \[.*\], 5 pages — /);
  });

  it('tentative band sits between 0.667 and 0.8', () => {
    // 9 of 10 units agree on a 1–5 scale; one is off by one: high but not perfect interval agreement.
    const units = [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [1, 1], [2, 2], [3, 3], [4, 4], [5, 4]];
    expect(judgeReliability(units, { level: 'interval' }).verdict).toBe('reliable');
    expect(judgeReliability([[1, 2], [2, 1], [1, 1], [2, 2], [1, 1], [2, 2], [1, 1], [2, 2]]).verdict).toBe('not settled');
  });
});
