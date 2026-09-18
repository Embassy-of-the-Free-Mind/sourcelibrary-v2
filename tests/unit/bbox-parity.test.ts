import { describe, it, expect } from 'vitest';
import { normalizeBbox, normalizeRotation, rescaleOutOfRange, MIN_BBOX_EXTENT, TENFOLD_MAX } from '@/lib/bbox';
import {
  normalizeBbox as normalizeMjs,
  normalizeRotation as normalizeRotationMjs,
  repairMixedUnitBbox,
  repairTenfoldResidual,
  rescaleOutOfRange as rescaleMjs,
  MIN_BBOX_EXTENT as MIN_MJS,
  TENFOLD_MAX as TENFOLD_MJS,
  TENFOLD_RESIDUAL_MAX,
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
  // The tenfold residual (#4780 day 4, 2026-09-17): one coordinate written on a 0–10 scale. A
  // permille value is an integer, so a non-integer in (1, 10] is ÷10, never ÷1000 — ÷1000 stored
  // 0.00133 for this frontispiece and the crop cut it at the waist (62 rows measured).
  ['a non-integer in (1, 10] is tenfold, not permille', { x: 0.068, y: 1.33, width: 0.58, height: 0.72 }, { x: 0.068, y: 0.133, width: 0.58, height: 0.72 }],
  ['an integer in (1, 10] is still permille — an edge-flush box', { x: 0.068, y: 6, width: 0.58, height: 0.72 }, { x: 0.068, y: 0.006, width: 0.58, height: 0.72 }],
  ['a non-integer above 10 is permille', { x: 0.068, y: 10.4, width: 0.58, height: 0.72 }, { x: 0.068, y: 0.0104, width: 0.58, height: 0.72 }],
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

  // Boethius p418 as the old normaliser stored it: three specks beside y = 0.00111. The speck
  // inversion alone returned y unchanged (it sat above the 0.001 threshold and looked edge-flush);
  // the crop was 30% blank on top and cut the plate's bottom quarter. Now the residual is caught too.
  it('restores the specks AND the tenfold residual beside them', () => {
    const fixed = repairMixedUnitBbox({ x: 0.000018, y: 0.00111, width: 0.00092, height: 0.000415 });
    expect(fixed).not.toBeNull();
    expect(fixed!.x).toBeCloseTo(0.018, 6);
    expect(fixed!.y).toBeCloseTo(0.111, 6);
    expect(fixed!.width).toBeCloseTo(0.92, 6);
    expect(fixed!.height).toBeCloseTo(0.415, 6);
  });
});

describe('repairTenfoldResidual: the band the speck inversion cannot see', () => {
  it('the band is (0.001, 0.01] — TENFOLD_MAX / 1000 — in both twins', () => {
    expect(TENFOLD_MJS).toBe(TENFOLD_MAX);
    expect(TENFOLD_RESIDUAL_MAX).toBeCloseTo(0.01, 12);
    expect(MIN_MJS / 5).toBeCloseTo(0.001, 12); // the speck threshold is the band's lower edge
  });

  it('restores a non-integer-permille y in the band ×100', () => {
    const fixed = repairTenfoldResidual({ x: 0.068, y: 0.00133, width: 0.58, height: 0.72 });
    expect(fixed).not.toBeNull();
    expect(fixed!.y).toBeCloseTo(0.133, 6);
    expect(fixed!.x).toBe(0.068);
  });

  it('pins the band edges: 0.001 and anything above 0.01 are left alone', () => {
    expect(repairTenfoldResidual({ x: 0.068, y: 0.001, width: 0.58, height: 0.72 })).toBeNull();
    expect(repairTenfoldResidual({ x: 0.0104, y: 0.19, width: 0.68, height: 0.3 })).toBeNull();
    expect(repairTenfoldResidual({ x: 0.0121, y: 0.11, width: 0.67, height: 0.17 })).toBeNull();
  });

  it('an integer permille in the band is a real edge-flush box, not a residual', () => {
    expect(repairTenfoldResidual({ x: 0.006, y: 0.2, width: 0.5, height: 0.4 })).toBeNull();
  });

  it('refuses a ×100 that would leave the page (a pixel-derived x such as 10/1030)', () => {
    expect(repairTenfoldResidual({ x: 0.009708737864077669, y: 0.194, width: 0.869, height: 0.806 })).toBeNull();
  });

  it('a healthy box is null', () => {
    expect(repairTenfoldResidual({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 })).toBeNull();
  });
});

describe('rescaleOutOfRange: the TS module and its .mjs twin', () => {
  it('agree on every branch', () => {
    for (const v of [0.5, 1, 1.33, 6, 9.99, 10, 10.4, 290, 1000]) {
      expect(rescaleMjs(v)).toBe(rescaleOutOfRange(v));
    }
    expect(rescaleOutOfRange(1.33)).toBeCloseTo(0.133, 12);
    expect(rescaleOutOfRange(6)).toBeCloseTo(0.006, 12);
    expect(rescaleOutOfRange(10.4)).toBeCloseTo(0.0104, 12);
    expect(rescaleOutOfRange(290)).toBeCloseTo(0.29, 12);
  });
});

describe('normalizeRotation: the per-illustration turn the model reports', () => {
  // The field existed on gallery docs and the thumbnail route honoured it, but no writer
  // produced it — Talhoffer's 269 sideways plates carried none (#4780, 2026-09-15).
  it('accepts the four quarter turns, as numbers or strings, and folds -90 / 450', () => {
    for (const [raw, want] of [[0, 0], [90, 90], [180, 180], [270, 270], ['90', 90], [-90, 270], [450, 90], [92, 90]] as const) {
      expect(normalizeRotation(raw)).toBe(want);
      expect(normalizeRotationMjs(raw)).toBe(want);
    }
  });
  it('drops what is absent or not a quarter turn', () => {
    for (const raw of [undefined, null, '', 'left', 45, 30, NaN, {}]) {
      expect(normalizeRotation(raw)).toBeUndefined();
      expect(normalizeRotationMjs(raw)).toBeUndefined();
    }
  });
});
