import { describe, it, expect } from 'vitest';
import { detectPageFrame, toPageFrame, usablePageFrame, bboxIntoFrame, frameForImage, framedImageBox } from '@/lib/page-frame';

/** A w×h luminance image: page value everywhere, `paint` overrides per pixel. */
function img(w: number, h: number, paint: (x: number, y: number) => number | undefined, page = 230) {
  const a = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = paint(x, y) ?? page;
  return a;
}

describe('detectPageFrame', () => {
  it('leaves a clean page alone', () => {
    expect(detectPageFrame(img(100, 140, () => undefined), 100, 140).kind).toBe('clean');
  });

  it('trims a dark bed on the right, past a bright sliver at the very edge', () => {
    // Page 13 of the Bodhicaryāvatāra: page, then black bed, then a white sliver.
    const v = detectPageFrame(img(100, 140, x => (x >= 98 ? 255 : x >= 86 ? 22 : undefined)), 100, 140);
    expect(v.kind).toBe('frame');
    if (v.kind !== 'frame') return;
    expect(v.box.x).toBe(0);
    expect(v.box.x + v.box.w).toBeLessThanOrEqual(86);
    expect(v.box.w).toBeGreaterThan(80);
    expect(v.box.h).toBe(140);
  });

  it('trims a bed on all four sides', () => {
    const v = detectPageFrame(img(100, 140, (x, y) => (x < 8 || x > 91 || y < 10 || y > 129 ? 25 : undefined)), 100, 140);
    expect(v.kind).toBe('frame');
    if (v.kind !== 'frame') return;
    expect(v.box.x).toBeGreaterThanOrEqual(8);
    expect(v.box.y).toBeGreaterThanOrEqual(10);
    expect(v.box.x + v.box.w).toBeLessThanOrEqual(92);
    expect(v.box.y + v.box.h).toBeLessThanOrEqual(130);
  });

  it('ignores a thin dark rule', () => {
    expect(detectPageFrame(img(100, 140, x => (x === 5 ? 10 : undefined)), 100, 140).kind).toBe('clean');
  });

  it('refuses a dark plate that runs past the edge zone', () => {
    expect(detectPageFrame(img(100, 140, x => (x >= 20 ? 20 : undefined)), 100, 140).kind).not.toBe('frame');
  });

  it('refuses an all-dark image', () => {
    expect(detectPageFrame(img(100, 140, () => 15), 100, 140)).toEqual({ kind: 'skip', reason: 'dark-page' });
  });

  it('refuses several leaves on one board (dark band across the kept box)', () => {
    // Bed on the left and right, and a dark gap between two palm leaves at mid-height.
    const v = detectPageFrame(img(200, 100, (x, y) => (x < 10 || x > 189 || (y >= 46 && y <= 53) ? 20 : undefined)), 200, 100);
    expect(v).toEqual({ kind: 'skip', reason: 'multi-leaf' });
  });
});

describe('stored frames', () => {
  it('round-trips through toPageFrame and usablePageFrame', () => {
    const f = toPageFrame({ x: 0, y: 0, w: 154, h: 256 }, 179, 256);
    expect(usablePageFrame(f)).toEqual(f);
    expect(f.w).toBeCloseTo(0.8603, 3);
  });

  it('rejects malformed or implausible values', () => {
    expect(usablePageFrame(null)).toBeNull();
    expect(usablePageFrame({ x: 0, y: 0, w: 0.3, h: 1, ar: 0.7, v: 1 })).toBeNull();
    expect(usablePageFrame({ x: 0, y: 0, w: 0.9, h: 1, v: 1 })).toBeNull();
    expect(usablePageFrame({ x: 0.5, y: 0, w: 0.8, h: 1, ar: 0.7, v: 1 })).toBeNull();
    expect(usablePageFrame({ x: 0, y: 0, w: '1', h: 1, v: 1 })).toBeNull();
  });

  it('maps a full-image bbox into the frame, and drops one outside it', () => {
    const f = { x: 0.1, y: 0, w: 0.8, h: 1, ar: 0.7, v: 1 };
    const m = bboxIntoFrame({ x: 0.5, y: 0.2, width: 0.2, height: 0.1 }, f)!;
    expect(m.x).toBeCloseTo(0.5, 5);
    expect(m.width).toBeCloseTo(0.25, 5);
    expect(bboxIntoFrame({ x: 0.92, y: 0.2, width: 0.05, height: 0.1 }, f)).toBeNull();
  });
});

describe('frameForImage', () => {
  const f = { x: 0, y: 0, w: 0.86, h: 1, ar: 0.7, v: 1 };
  it('applies to the same picture at another resolution', () => {
    expect(frameForImage(f, 2100, 3000)).toBe(f);
    expect(frameForImage(f, 700, 1000)).toBe(f);
  });
  it('refuses an image of another shape', () => {
    expect(frameForImage(f, 2400, 3000)).toBeNull();
  });
});

describe('framedImageBox', () => {
  it('scales the scan so the frame fills the clip, offset to the frame origin', () => {
    // Bed on the left 10% and right 4%: a 500px-wide clip shows the middle 86%.
    const b = framedImageBox(500, 700, { x: 0.1, y: 0, w: 0.86, h: 1, ar: 0.7, v: 1 });
    expect(b.width).toBeCloseTo(581.4, 1);
    expect(b.left).toBeCloseTo(-58.14, 1);
    expect(b.top).toBe(-0);
    expect(b.height).toBe(700);
    // The frame's right edge lands exactly on the clip's right edge.
    expect(b.left + b.width * (0.1 + 0.86)).toBeCloseTo(500, 6);
  });
});

describe('detectPageFrame on a tilted page', () => {
  // A page whose right edge slopes from x=88 at the top to x=82 at the bottom
  // (about 2.5°), bed beyond it: the cut must clear the bed in every row.
  const edge = (y: number) => 88 - Math.round((y / 139) * 6);

  it('cuts at the innermost point of the edge, leaving no wedge of bed', () => {
    const v = detectPageFrame(img(100, 140, (x, y) => (x >= edge(y) ? 22 : undefined)), 100, 140);
    expect(v.kind).toBe('frame');
    if (v.kind !== 'frame') return;
    expect(v.box.x + v.box.w).toBeLessThanOrEqual(82);
    expect(v.box.w).toBeGreaterThan(75);
  });

  it('keeps the mid-slope cut when the tighter one would trim ink', () => {
    // 200×280, right edge sloping 176 → 164. A margin note near the top sits at x 166,
    // with paper between it and the bed: the innermost cut would slice it off.
    const e = (y: number) => 176 - Math.round((y / 279) * 12);
    const v = detectPageFrame(
      img(200, 280, (x, y) => (x >= e(y) ? 22 : x === 166 && y < 80 && y % 4 === 0 ? 40 : undefined)),
      200, 280,
    );
    // Either a frame that keeps the note, or no frame (the page shows whole).
    if (v.kind === 'frame') expect(v.box.x + v.box.w).toBeGreaterThan(166);
    else expect(v.kind).toBe('skip');
  });
});

describe('detectPageFrame keeps printing behind a paper margin', () => {
  it('does not take a dark headpiece below a top margin for bed', () => {
    // Bed on the left; at the top, 10% of paper and then a dense ornament band
    // (the Index Anglicus page in wave 1 of the sweep lost its headpiece this way).
    // A frame must keep the band; refusing the page (it shows whole) is also safe.
    const v = detectPageFrame(img(100, 140, (x, y) => (x < 8 ? 20 : y >= 14 && y < 19 ? 30 : undefined)), 100, 140);
    if (v.kind === 'frame') expect(v.box.y).toBe(0);
    else expect(v.kind).toBe('skip');
  });

  it('still trims bed behind a narrow bright sliver', () => {
    const v = detectPageFrame(img(100, 140, (x, y) => (y < 2 ? 255 : y < 14 ? 20 : undefined)), 100, 140);
    expect(v.kind).toBe('frame');
    if (v.kind !== 'frame') return;
    expect(v.box.y).toBeGreaterThanOrEqual(14);
  });
});

describe('detectPageFrame refuses a spine', () => {
  it('leaves a photo of a spine whole', () => {
    // 40×200: a spine on a dark ground (wave 1: IA and Gallica spine shots lost their ends).
    expect(detectPageFrame(img(40, 200, (x, y) => (x < 6 || x > 33 || y > 180 ? 20 : undefined)), 40, 200))
      .toEqual({ kind: 'skip', reason: 'not-a-page' });
  });
});

describe('detectPageFrame refuses printing mistaken for bed', () => {
  it('shows a page whole when a text column sits just past the cut', () => {
    // Bed on the left, then a dense text column (ink rows alternating with paper):
    // its column means read as bed. Wave 1b cut a whole Latin column this way.
    // Downsampled letters: strokes of ink three pixels wide with paper between.
    const v = detectPageFrame(img(100, 140, x => (x < 4 ? 20 : x < 22 && x % 4 !== 3 ? 30 : undefined)), 100, 140);
    expect(v.kind).not.toBe('frame');
  });
});
