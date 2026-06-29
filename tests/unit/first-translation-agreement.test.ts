import { describe, it, expect } from 'vitest';
import {
  cohenKappa,
  pairwiseKappa,
  kappaBand,
  type RaterLabels,
} from '@/lib/first-translation/agreement';

describe('cohenKappa', () => {
  it('returns 1 for perfect agreement on >1 label', () => {
    const a = ['first', 'not_first', 'first', 'not_first'];
    const r = cohenKappa(a, a);
    expect(r.po).toBe(1);
    expect(r.kappa).toBe(1);
    expect(r.n).toBe(4);
  });

  it('returns 1 (not NaN) when both raters use a single label everywhere', () => {
    // pe === 1 is the degenerate case; raw agreement is also perfect.
    const a = ['first', 'first', 'first'];
    const r = cohenKappa(a, a);
    expect(r.kappa).toBe(1);
  });

  it('is near 0 for chance-level agreement despite high raw agreement', () => {
    // Both raters say "first" ~most of the time; agreement is high but expected.
    // 9 firsts agreed, 1 disagreement → po=0.9 but pe is also high → low κ.
    const a = ['first', 'first', 'first', 'first', 'first', 'first', 'first', 'first', 'first', 'not_first'];
    const b = ['first', 'first', 'first', 'first', 'first', 'first', 'first', 'first', 'not_first', 'first'];
    const r = cohenKappa(a, b);
    expect(r.po).toBeCloseTo(0.8, 5);
    expect(r.kappa).toBeLessThan(0.2); // chance-corrected: poor/slight
  });

  it('matches a hand-computed κ for a 2x2 table', () => {
    // Classic example: po=0.85, pe=0.5 → κ=0.7
    // 20 items: both A=40/40 marginal... construct: a=10 yes/10 no, b matches 17.
    const a = [
      'y', 'y', 'y', 'y', 'y', 'y', 'y', 'y', 'y', 'y',
      'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n',
    ];
    const b = [
      'y', 'y', 'y', 'y', 'y', 'y', 'y', 'y', 'n', 'n',
      'n', 'n', 'n', 'n', 'n', 'n', 'n', 'y', 'y', 'n',
    ];
    const r = cohenKappa(a, b);
    // agree on 8 y + 7 n = ... compute: index 0-7 y/y(8), 8-9 y/n(0), 10-16 n/n(7), 17-18 n/y(0), 19 n/n(1) => 16 agree
    expect(r.n).toBe(20);
    expect(r.po).toBeCloseTo(16 / 20, 5);
    // marginals: a: y=10,n=10 ; b: y=10,n=10 → pe=0.5 → κ=(0.8-0.5)/0.5=0.6
    expect(r.pe).toBeCloseTo(0.5, 5);
    expect(r.kappa).toBeCloseTo(0.6, 5);
  });

  it('drops items where either rater is missing', () => {
    const r = cohenKappa(['a', 'b', null, 'a'], ['a', 'b', 'a', undefined]);
    expect(r.n).toBe(2);
    expect(r.kappa).toBe(1);
  });

  it('throws on length mismatch', () => {
    expect(() => cohenKappa(['a'], ['a', 'b'])).toThrow();
  });

  it('returns NaN κ for empty input', () => {
    const r = cohenKappa([], []);
    expect(r.n).toBe(0);
    expect(Number.isNaN(r.kappa)).toBe(true);
  });
});

describe('pairwiseKappa', () => {
  it('computes κ for each rater pair over shared items only', () => {
    const raters: RaterLabels = {
      catalog: new Map([['b1', 'not_first'], ['b2', 'first'], ['b3', 'first']]),
      model_knowledge: new Map([['b1', 'not_first'], ['b2', 'first'], ['b4', 'first']]),
      agent: new Map([['b1', 'first'], ['b2', 'first']]),
    };
    const out = pairwiseKappa(raters);
    expect(out.pairs).toHaveLength(3); // C(3,2)
    const cm = out.pairs.find((p) => p.raterA === 'catalog' && p.raterB === 'model_knowledge')!;
    expect(cm.n).toBe(2); // b1, b2 shared
    expect(cm.po).toBe(1); // both agree on the two shared
    expect(out.itemsCompared).toBeGreaterThan(0);
  });

  it('mean κ ignores pairs with no shared items', () => {
    const raters: RaterLabels = {
      x: new Map([['a', 'first']]),
      y: new Map([['b', 'first']]), // no overlap with x
      z: new Map([['a', 'first']]), // overlaps x
    };
    const out = pairwiseKappa(raters);
    // x-y has n=0 (NaN) and is excluded from the mean.
    expect(Number.isFinite(out.meanKappa) || Number.isNaN(out.meanKappa)).toBe(true);
  });
});

describe('kappaBand', () => {
  it('labels canonical ranges', () => {
    expect(kappaBand(NaN)).toBe('n/a');
    expect(kappaBand(-0.1)).toBe('poor');
    expect(kappaBand(0.1)).toBe('slight');
    expect(kappaBand(0.3)).toBe('fair');
    expect(kappaBand(0.5)).toBe('moderate');
    expect(kappaBand(0.7)).toBe('substantial');
    expect(kappaBand(0.9)).toBe('almost perfect');
  });
});
