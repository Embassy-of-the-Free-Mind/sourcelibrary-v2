import { describe, it, expect } from 'vitest';
import { findPageBox } from '@/lib/journey/page-trim';

/** A w×h luminance image: page value everywhere, `paint` overrides per pixel. */
function img(w: number, h: number, paint: (x: number, y: number) => number | undefined, page = 230) {
  const a = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = paint(x, y) ?? page;
  return a;
}

describe('findPageBox', () => {
  it('returns null for a clean page', () => {
    expect(findPageBox(img(100, 140, () => undefined), 100, 140)).toBeNull();
  });

  it('trims a dark scanner bed on the right, past a bright sliver at the very edge', () => {
    // The page-13 shape: page, then black bed, then a 2px white sliver.
    const box = findPageBox(img(100, 140, x => (x >= 98 ? 255 : x >= 86 ? 22 : undefined)), 100, 140);
    expect(box).not.toBeNull();
    expect(box!.x).toBe(0);
    expect(box!.x + box!.w).toBeLessThanOrEqual(86);
    expect(box!.w).toBeGreaterThan(80);
    expect(box!.h).toBe(140);
  });

  it('ignores a thin dark rule (narrower than a border)', () => {
    expect(findPageBox(img(100, 140, x => (x === 5 ? 10 : undefined)), 100, 140)).toBeNull();
  });

  it('refuses to crop a dark plate that fills most of the page', () => {
    // Dark from x=20 to the right edge: the run is still open where the edge zone ends.
    expect(findPageBox(img(100, 140, x => (x >= 20 ? 20 : undefined)), 100, 140)).toBeNull();
  });

  it('does not judge an all-dark image', () => {
    expect(findPageBox(img(100, 140, () => 15), 100, 140)).toBeNull();
  });
});
