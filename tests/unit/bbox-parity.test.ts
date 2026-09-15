import { describe, it, expect } from 'vitest';
import { normalizeBbox, MIN_BBOX_EXTENT } from '@/lib/bbox';
import {
  normalizeBbox as normalizeMjs,
  repairMixedUnitBbox,
  MIN_BBOX_EXTENT as MIN_MJS,
} from '../../scripts/lib/bbox.mjs';

/**
 * Four inline copies of `normalizeBbox` shared one defect: the model returned MIXED
 * units in one box (`y: 290` beside `x: 0.498`) and whole-box scaling turned the
 * fractional fields into 1-pixel specks that every downstream filter accepted.
 * Measured 2026-09-14: 6% of the gallery rows written that day. The TS module and
 * its .mjs twin now carry one rule; this pins the rule and that they agree.
 */
const cases: Array<[string, Record<string, unknown>, { x: number; y: number; width: number; height: number } | null]> = [
  ['plain fractions pass through', { x: 0.15, y: 0.25, width: 0.7, height: 0.45 }, { x: 0.15, y: 0.25, width: 0.7, height: 0.45 }],
  ['uniform 0–1000 scales the whole box', { x: 150, y: 250, width: 700, height: 450 }, { x: 0.15, y: 0.25, width: 0.7, height: 0.45 }],
  ['uniform pixels scale to the largest extent', { x: 1000, y: 1000, width: 1500, height: 2000 }, { x: 1000 / 3000, y: 1000 / 3000, width: 0.5, height: 2000 / 3000 }],
  // The measured defect: Mallakhamb p.34 — the old code stored 0.000498 / 0.29 / 0.000192 / 0.000115.
  ['mixed units rescale only the out-of-range field', { x: 0.498, y: 290, width: 0.192, height: 0.115 }, { x: 0.498, y: 0.29, width: 0.192, height: 0.115 }],
  ['strings are parsed', { x: '0.1', y: '0.2', width: '0.3', height: '0.4' }, { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }],
  ['a degenerate box is dropped, not published', { x: 0.5, y: 0.5, width: 0.001, height: 0.2 }, null],
  ['a missing box is null', undefined as unknown as Record<string, unknown>, null],
];

describe('normalizeBbox: the TS module and its .mjs twin', () => {
  it('share the minimum extent', () => {
    expect(MIN_MJS).toBe(MIN_BBOX_EXTENT);
  });

  for (const [name, raw, expected] of cases) {
    it(name, () => {
      const ts = normalizeBbox(raw);
      const mjs = normalizeMjs(raw);
      expect(mjs).toEqual(ts);
      if (expected === null) {
        expect(ts).toBeNull();
      } else {
        expect(ts).not.toBeNull();
        for (const k of ['x', 'y', 'width', 'height'] as const) expect(ts![k]).toBeCloseTo(expected[k], 6);
      }
    });
  }
});

describe('repairMixedUnitBbox: undoing the old normaliser', () => {
  it('recovers the measured Mallakhamb box', () => {
    const fixed = repairMixedUnitBbox({ x: 0.000498, y: 0.29, width: 0.000192, height: 0.000115 });
    expect(fixed).not.toBeNull();
    expect(fixed!.x).toBeCloseTo(0.498, 6);
    expect(fixed!.y).toBeCloseTo(0.29, 6);
    expect(fixed!.width).toBeCloseTo(0.192, 6);
    expect(fixed!.height).toBeCloseTo(0.115, 6);
  });

  it('leaves a healthy box alone', () => {
    expect(repairMixedUnitBbox({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 })).toBeNull();
  });

  it('does not treat a box flush against the page edge as damaged', () => {
    expect(repairMixedUnitBbox({ x: 0.0004, y: 0.2, width: 0.3, height: 0.4 })).toBeNull();
  });

  it('refuses an inversion that would leave the page', () => {
    expect(repairMixedUnitBbox({ x: 0.9, y: 0.2, width: 0.0005, height: 0.4 })).toBeNull();
  });
});
