import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs script, no types
import { judge } from '../../scripts/audit/search-probe.mjs';

const run = (ms: number[], errors = 0) => ({ n: ms.length, errors, p90: [...ms].sort((a, b) => a - b)[Math.ceil(0.9 * ms.length) - 1], ms });
const quiet = () => ({ surfaces: { search: run([500, 520, 540, 560, 580, 600, 620, 640, 660, 680]) } });
const history = Array.from({ length: 30 }, quiet);
const spike = { surfaces: { search: run([500, 520, 540, 560, 580, 600, 620, 640, 4000, 4400]) } };

describe('search-probe judge (#2049)', () => {
  it('one slow run is not SLOW: p90 of ten calls is one outlier', () => {
    expect(judge(spike, history).search.slow).toBe(false);
  });

  it('two slow runs in a row are SLOW (positive control)', () => {
    expect(judge(spike, [...history, spike]).search.slow).toBe(true);
  });

  it('a quiet run after a slow one clears', () => {
    expect(judge(quiet(), [...history, spike]).search.slow).toBe(false);
  });
});
