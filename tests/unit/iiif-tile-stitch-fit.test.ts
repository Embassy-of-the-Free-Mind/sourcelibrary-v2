import { describe, it, expect } from 'vitest';
import { tileFits } from '../../scripts/lib/iiif-utils.mjs';

/**
 * #4523. `fetchIiifNativeRes` composites region tiles onto a WHITE canvas at
 * `left = col*chunk`. If a server silently downscales the region it was asked
 * for, the short tile lands in the cell's top-left and the rest of the cell
 * stays canvas — a master with holes in it.
 *
 * That failure is invisible everywhere downstream: R2 serves a complete 200-OK
 * JPEG, the blank-page guard keys on ink coverage (these leaves are dense), and
 * the OCR model reads the fragments as a whole page and invents the missing
 * text. `rearchive-iiif-fullres.mjs` passed EAP's *advertised* 2000px cap while
 * EAP serves 1200 — 0.6 linear, 0.36 area, masters that are 64% white. ~30% of
 * OCR-bearing Tibetan pages were archived that way in July 2026.
 *
 * So the stitcher must refuse rather than paste. These cases pin the refusal.
 *
 * Negative control run when written: widening the tolerance to `<= 800` (i.e.
 * accepting the EAP shortfall) turns the "the actual #4523 shortfall" case
 * green, which is the bug.
 */
describe('tileFits — the stitcher refuses a tile that does not fill its cell', () => {
  it('accepts an exact match', () => {
    expect(tileFits(1024, 1024, 1024, 1024)).toBe(true);
  });

  it('accepts 1px rounding on a scaled region height', () => {
    // IIIF servers round a region's scaled height inconsistently; 1px of slack
    // is real-world tolerance, not a loophole.
    expect(tileFits(1024, 593, 1024, 592)).toBe(true);
    expect(tileFits(1024, 592, 1024, 593)).toBe(true);
  });

  it('rejects the actual #4523 shortfall: asked 2000, served 1200', () => {
    expect(tileFits(2000, 2000, 1200, 1200)).toBe(false);
  });

  it('rejects a shortfall on one axis only', () => {
    expect(tileFits(2000, 2000, 2000, 1200)).toBe(false);
    expect(tileFits(2000, 2000, 1200, 2000)).toBe(false);
  });

  it('rejects a 2px shortfall — anything beyond rounding is a real cap', () => {
    expect(tileFits(1024, 1024, 1022, 1024)).toBe(false);
  });

  it('rejects unreadable metadata rather than assuming a fit', () => {
    // sharp returns undefined dimensions for a body that is not an image at
    // all — an HTML error page, say. Absence is not a pass.
    expect(tileFits(1024, 1024, undefined, undefined)).toBe(false);
    expect(tileFits(1024, 1024, 0, 0)).toBe(false);
  });
});
