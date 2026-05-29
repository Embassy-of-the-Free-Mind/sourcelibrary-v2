import { describe, it, expect } from 'vitest';
import { rrfScores } from '@/lib/search/rrf';

describe('rrfScores', () => {
  it('scores a single list by reciprocal rank', () => {
    const s = rrfScores([['a', 'b', 'c']], 60);
    expect(s.get('a')).toBeCloseTo(1 / 61, 10);
    expect(s.get('b')).toBeCloseTo(1 / 62, 10);
    expect(s.get('c')).toBeCloseTo(1 / 63, 10);
  });

  it('sums contributions across lists so cross-list agreement wins', () => {
    // "b" is rank 1 in both lists; "a" and "c" each top one list only.
    const s = rrfScores([
      ['a', 'b'],
      ['c', 'b'],
    ], 60);
    const ranked = [...s.entries()].sort((x, y) => y[1] - x[1]).map(([k]) => k);
    // 'b' is rank 1 (0-based) in both lists → 1/62 + 1/62, beating the single
    // rank-0 contribution (1/61) that 'a' and 'c' each get.
    expect(ranked[0]).toBe('b');
    expect(s.get('b')).toBeCloseTo(1 / 62 + 1 / 62, 10);
    expect(s.get('a')).toBeCloseTo(1 / 61, 10);
  });

  it('dedupes within a single list (no double-count, rank advances on new keys)', () => {
    const s = rrfScores([['a', 'a', 'b']], 60);
    expect(s.get('a')).toBeCloseTo(1 / 61, 10); // only first 'a' counts
    expect(s.get('b')).toBeCloseTo(1 / 62, 10); // 'b' is rank 1, not rank 2
  });

  it('ignores empty lists and returns an empty map for no input', () => {
    expect(rrfScores([]).size).toBe(0);
    expect(rrfScores([[], []]).size).toBe(0);
  });

  it('respects a custom k', () => {
    const s = rrfScores([['a']], 20);
    expect(s.get('a')).toBeCloseTo(1 / 21, 10);
  });
});
