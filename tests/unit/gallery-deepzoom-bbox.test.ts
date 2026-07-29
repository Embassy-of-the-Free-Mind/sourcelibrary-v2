import { describe, it, expect } from 'vitest';
import {
  remapBboxToMaster,
  type DeepZoomRemapPage,
  type NormalizedBbox,
} from '@/lib/gallery-deepzoom-bbox';

const R2 = 'https://images.sourcelibrary.org';
const BOOK = '69528ff8b184004c526a1365';

/**
 * Real measured fixture — `on-famous-women-de-claris-mulieribus-boccaccio-4`
 * page 20, gallery image `69528ff8b184004c526a1379-0`. Non-split BSB scan whose
 * master and half dimensions are identical (verified against production).
 */
const ILLUSTRATION: NormalizedBbox = { x: 0.228, y: 0.188, width: 0.495, height: 0.258 };

const nonSplit: DeepZoomRemapPage = { image_width: 3477, image_height: 4948 };

/**
 * New-era split geometry as `batch-split-bph.mjs` writes it: a ~3500px-wide
 * spread cut near the middle with a binding overlap folded into the crop bounds.
 * Left half spans 0–512‰, so the spread is 3477 / 0.512 ≈ 6791px wide.
 */
const SPREAD_W = Math.round(3477 / 0.512);
const spreadMaster = { width: SPREAD_W, height: 4948 };

const newSplitLeft: DeepZoomRemapPage = {
  split_from_spread: true,
  crop: { xStart: 0, xEnd: 512 },
  image_width: 3477,
  image_height: 4948,
};

// Right half starts at splitPosition − OVERLAP_PX, so the two halves overlap.
const RIGHT_START = 488;
const newSplitRight: DeepZoomRemapPage = {
  split_from_spread: true,
  crop: { xStart: RIGHT_START, xEnd: 1000 },
  image_width: Math.round(SPREAD_W * (1000 - RIGHT_START) / 1000),
  image_height: 4948,
};

describe('remapBboxToMaster', () => {
  describe('non-split pages (every tiled page in production today)', () => {
    it('passes the bbox through unchanged', () => {
      expect(remapBboxToMaster(ILLUSTRATION, nonSplit, { width: 3477, height: 4948 }))
        .toEqual(ILLUSTRATION);
    });

    it('does not mutate the caller’s bbox', () => {
      const input = { ...ILLUSTRATION };
      const out = remapBboxToMaster(input, nonSplit, { width: 3477, height: 4948 });
      expect(out).not.toBe(input);
      expect(input).toEqual(ILLUSTRATION);
    });

    it('works without half dimensions — they are only needed to reason about splits', () => {
      expect(remapBboxToMaster(ILLUSTRATION, {}, { width: 3477, height: 4948 }))
        .toEqual(ILLUSTRATION);
    });
  });

  describe('new-era split, spread master', () => {
    it('compresses x/width into the left half’s slice and leaves y/height alone', () => {
      const out = remapBboxToMaster(ILLUSTRATION, newSplitLeft, spreadMaster)!;
      expect(out).not.toBeNull();
      // frac = 0.512, originX = 0
      expect(out.x).toBeCloseTo(0.228 * 0.512, 6);
      expect(out.width).toBeCloseTo(0.495 * 0.512, 6);
      expect(out.y).toBe(ILLUSTRATION.y);
      expect(out.height).toBe(ILLUSTRATION.height);
    });

    it('offsets the right half by its crop origin', () => {
      const out = remapBboxToMaster(ILLUSTRATION, newSplitRight, spreadMaster)!;
      expect(out).not.toBeNull();
      const frac = (1000 - RIGHT_START) / 1000;
      expect(out.x).toBeCloseTo(RIGHT_START / 1000 + 0.228 * frac, 6);
      expect(out.width).toBeCloseTo(0.495 * frac, 6);
    });

    it('keeps the remapped rectangle inside the master', () => {
      for (const page of [newSplitLeft, newSplitRight]) {
        const out = remapBboxToMaster({ x: 0, y: 0, width: 1, height: 1 }, page, spreadMaster)!;
        expect(out).not.toBeNull();
        expect(out.x).toBeGreaterThanOrEqual(0);
        expect(out.x + out.width).toBeLessThanOrEqual(1 + 1e-9);
      }
    });

    it('carries the binding overlap through rather than correcting for it', () => {
      // The halves overlap by design, so their remapped spans must too.
      const left = remapBboxToMaster({ x: 0, y: 0, width: 1, height: 1 }, newSplitLeft, spreadMaster)!;
      const right = remapBboxToMaster({ x: 0, y: 0, width: 1, height: 1 }, newSplitRight, spreadMaster)!;
      expect(left.x + left.width).toBeGreaterThan(right.x);
    });
  });

  describe('old-era split (materialized cropped_photo)', () => {
    it('remaps when crop coords are present', () => {
      const oldSplit: DeepZoomRemapPage = {
        cropped_photo: `${R2}/cropped/${BOOK}/abc123.jpg`,
        crop: { xStart: 0, xEnd: 512 },
        image_width: 3477,
        image_height: 4948,
      };
      const out = remapBboxToMaster(ILLUSTRATION, oldSplit, spreadMaster)!;
      expect(out.x).toBeCloseTo(0.228 * 0.512, 6);
    });

    it('fails closed when the legacy row has no crop coords', () => {
      const noCrop: DeepZoomRemapPage = {
        cropped_photo: `${R2}/cropped/${BOOK}/abc123.jpg`,
        image_width: 3477,
        image_height: 4948,
      };
      expect(remapBboxToMaster(ILLUSTRATION, noCrop, spreadMaster)).toBeNull();
    });
  });

  describe('detects a master that is already the half', () => {
    it('passes through when master aspect matches the half, ignoring crop', () => {
      // A split page whose master happens to be the half — the crop must NOT be
      // applied, or the rectangle would be squeezed into a quarter of the image.
      expect(remapBboxToMaster(ILLUSTRATION, newSplitLeft, { width: 3477, height: 4948 }))
        .toEqual(ILLUSTRATION);
    });
  });

  describe('fails closed', () => {
    it('on a missing or degenerate bbox', () => {
      const master = { width: 3477, height: 4948 };
      expect(remapBboxToMaster(null, nonSplit, master)).toBeNull();
      expect(remapBboxToMaster(undefined, nonSplit, master)).toBeNull();
      expect(remapBboxToMaster({ x: 0.1, y: 0.1, width: 0, height: 0.2 }, nonSplit, master)).toBeNull();
      expect(remapBboxToMaster({ x: 0.1, y: 0.1, width: NaN, height: 0.2 }, nonSplit, master)).toBeNull();
    });

    it('on missing master dimensions', () => {
      expect(remapBboxToMaster(ILLUSTRATION, nonSplit, null)).toBeNull();
      expect(remapBboxToMaster(ILLUSTRATION, nonSplit, { width: 3477 })).toBeNull();
      expect(remapBboxToMaster(ILLUSTRATION, nonSplit, { width: 0, height: 0 })).toBeNull();
    });

    it('on a missing page doc', () => {
      expect(remapBboxToMaster(ILLUSTRATION, null, { width: 3477, height: 4948 })).toBeNull();
    });

    it('on a split page with no half dimensions', () => {
      const noDims: DeepZoomRemapPage = {
        split_from_spread: true,
        crop: { xStart: 0, xEnd: 512 },
      };
      expect(remapBboxToMaster(ILLUSTRATION, noDims, spreadMaster)).toBeNull();
    });

    it('on nonsensical crop bounds', () => {
      const bad = (crop: { xStart: number; xEnd: number }) =>
        remapBboxToMaster(ILLUSTRATION, { ...newSplitLeft, crop }, spreadMaster);
      expect(bad({ xStart: 512, xEnd: 512 })).toBeNull(); // zero width
      expect(bad({ xStart: 600, xEnd: 400 })).toBeNull(); // inverted
      expect(bad({ xStart: -10, xEnd: 512 })).toBeNull(); // out of range
      expect(bad({ xStart: 0, xEnd: 1200 })).toBeNull();  // out of range
    });

    it('when the crop contradicts the master aspect ratio', () => {
      // Claiming a 20% slice against a master only ~2x the half's width is
      // incoherent — one of the two signals is wrong, so refuse to guess.
      expect(remapBboxToMaster(ILLUSTRATION, { ...newSplitLeft, crop: { xStart: 0, xEnd: 200 } }, spreadMaster))
        .toBeNull();
    });

    it('when the master is a different image entirely', () => {
      expect(remapBboxToMaster(ILLUSTRATION, newSplitLeft, { width: 4000, height: 4000 }))
        .toBeNull();
    });
  });

  describe('known limitation of the aspect cross-check', () => {
    it('cannot reject a master whose aspect coincidentally matches', () => {
      // A transposed 4948x3477 master has aspect 1.423 against an expected
      // 1.372 — 3.7% off, inside ASPECT_TOLERANCE. The guard catches geometry
      // that is *incoherent*, not geometry that is coherent but wrong. Pinned
      // so nobody reads the guard as stronger than it is; the real protection
      // for a mismatched master is that the manifest is read off the same page
      // doc as the crop.
      expect(remapBboxToMaster(ILLUSTRATION, newSplitLeft, { width: 4948, height: 3477 }))
        .not.toBeNull();
    });
  });

  describe('tolerates real-world rounding', () => {
    it('accepts a spread master a few pixels off the exact ratio', () => {
      const out = remapBboxToMaster(ILLUSTRATION, newSplitLeft, { width: SPREAD_W + 7, height: 4948 });
      expect(out).not.toBeNull();
    });
  });
});
