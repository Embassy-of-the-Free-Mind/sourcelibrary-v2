/**
 * Page frame: where the page sits inside a scan that also shows the dark
 * scanner bed, book board or neighbouring leaf around it (#5876).
 *
 * The frame is stored as fractions of the image `getPageImageUrl()` returns and
 * applied at display time. The image itself is never rewritten, so every bbox
 * stored against that image (detected_images, gallery, deep-zoom remap) stays
 * valid — see .claude/docs/invariants/image-quality-and-bboxes.md.
 *
 * Only bands DARKER than the page are trimmed. White canvas margins (#4276)
 * are a different problem and are left alone.
 *
 * PRIOR ART: scripts/auto-crop-black-borders.mjs — rewrites display_photo /
 * cropped_photo with sharp trim(), which seeds from the corner pixel and breaks
 * bbox coordinates; src/lib/journey/page-trim.ts (PR #5863) — the display-only
 * trim this generalises, kept local to the film until that PR merges.
 */

/** A frame in fractions (0–1) of the image's width and height. */
export interface PageFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Aspect ratio (w/h) of the image it was measured on. A copy of another
   *  shape (a provider master framed differently) must not get this frame. */
  ar: number;
  /** Detector version that produced it. */
  v: number;
}

export const PAGE_FRAME_VERSION = 1;

/** Box in pixels of the analysed (usually downsampled) image. */
export interface PixelBox { x: number; y: number; w: number; h: number }

export type FrameVerdict =
  | { kind: 'frame'; box: PixelBox }
  | { kind: 'clean' }
  | { kind: 'skip'; reason: 'dark-page' | 'too-much' | 'multi-leaf' | 'tiny' };

/** Below this fraction of the page's median brightness, an edge band is scanner bed. */
const DARK_RATIO = 0.6;
/** Extra inset past the detected edge, as a fraction of the size, to clear the shadow ramp. */
const INSET = 0.006;
/** Never keep less than this fraction of either dimension: a dark plate is not a border. */
const MIN_KEEP = 0.6;
/** How far in from each edge a border may reach. */
const EDGE_ZONE = 0.3;
/** A dark band narrower than this (fraction of the size) is a rule or shadow, not bed. */
const MIN_RUN = 0.02;
/** Trimming less than this fraction of the area is not worth a frame. */
const MIN_TRIM_AREA = 0.02;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

/** Innermost cut past a dark band in the outer EDGE_ZONE of one side. */
function cutFrom(m: number[], thr: number, fromEnd: boolean): number {
  const n = m.length, zone = Math.floor(n * EDGE_ZONE), minRun = Math.max(2, Math.round(n * MIN_RUN));
  let cut = fromEnd ? n - 1 : 0, run = 0;
  for (let i = 0; i < zone; i++) {
    const k = fromEnd ? n - 1 - i : i;
    if (m[k] < thr) {
      run++;
      // Scanners often leave a thin bright sliver OUTSIDE the bed, so the cut is
      // the innermost qualifying run, not the first bright column from the edge.
      if (run >= minRun) cut = fromEnd ? k - 1 : k + 1;
    } else run = 0;
  }
  // A run still open where the zone ends continues inward: a dark plate, not a border.
  if (run >= minRun) return fromEnd ? n - 1 : 0;
  return cut;
}

/** True when a dark band at least MIN_RUN thick runs across the inside of [a, b]. */
function interiorDarkBand(m: number[], thr: number, a: number, b: number): boolean {
  const minRun = Math.max(2, Math.round(m.length * MIN_RUN));
  let run = 0;
  for (let k = a; k <= b; k++) {
    if (m[k] < thr) { if (++run >= minRun) return true; } else run = 0;
  }
  return false;
}

/**
 * `lum` is a row-major luminance array (0–255) of a `w`×`h` image, usually a
 * copy downsampled to ~256px on the long side.
 */
export function detectPageFrame(lum: ArrayLike<number>, w: number, h: number): FrameVerdict {
  if (w < 16 || h < 16) return { kind: 'skip', reason: 'tiny' };
  const col = new Array<number>(w).fill(0);
  const row = new Array<number>(h).fill(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = lum[y * w + x];
      col[x] += v; row[y] += v;
    }
  }
  for (let x = 0; x < w; x++) col[x] /= h;
  for (let y = 0; y < h; y++) row[y] /= w;

  const ref = median(col.slice(Math.floor(w * 0.25), Math.ceil(w * 0.75)));
  if (ref < 40) return { kind: 'skip', reason: 'dark-page' };
  const thr = ref * DARK_RATIO;

  let l = cutFrom(col, thr, false), r = cutFrom(col, thr, true);
  let t = cutFrom(row, thr, false), b = cutFrom(row, thr, true);
  if (l === 0 && r === w - 1 && t === 0 && b === h - 1) return { kind: 'clean' };

  const ix = Math.round(w * INSET), iy = Math.round(h * INSET);
  if (l > 0) l += ix;
  if (r < w - 1) r -= ix;
  if (t > 0) t += iy;
  if (b < h - 1) b -= iy;
  const box = { x: l, y: t, w: r - l + 1, h: b - t + 1 };
  if (box.w < w * MIN_KEEP || box.h < h * MIN_KEEP) return { kind: 'skip', reason: 'too-much' };
  if ((box.w * box.h) / (w * h) > 1 - MIN_TRIM_AREA) return { kind: 'clean' };

  // Several leaves on one board (palm-leaf pothi frames), or a spread with a dark
  // gutter: dark bands cross the kept box. One frame cannot show "the page" there.
  const inner = (m: number[], a: number, z: number) => {
    const pad = Math.round((z - a) * 0.08);
    return interiorDarkBand(m, thr, a + pad, z - pad);
  };
  const rowsIn = new Array<number>(h).fill(0), colsIn = new Array<number>(w).fill(0);
  for (let y = t; y <= b; y++) for (let x = l; x <= r; x++) {
    const v = lum[y * w + x]; rowsIn[y] += v; colsIn[x] += v;
  }
  for (let y = t; y <= b; y++) rowsIn[y] /= box.w;
  for (let x = l; x <= r; x++) colsIn[x] /= box.h;
  if (inner(rowsIn, t, b) || inner(colsIn, l, r)) return { kind: 'skip', reason: 'multi-leaf' };

  return { kind: 'frame', box };
}

/** Convert a pixel box of a `w`×`h` analysis image to a stored frame. */
export function toPageFrame(box: PixelBox, w: number, h: number): PageFrame {
  const r = (n: number) => Math.round(n * 10000) / 10000;
  return { x: r(box.x / w), y: r(box.y / h), w: r(box.w / w), h: r(box.h / h), ar: r(w / h), v: PAGE_FRAME_VERSION };
}

/** A stored value that is safe to apply; anything else means "show the full image". */
export function usablePageFrame(f: unknown): PageFrame | null {
  if (!f || typeof f !== 'object') return null;
  const { x, y, w, h, ar, v } = f as Record<string, unknown>;
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  if (!ok(x) || !ok(y) || !ok(w) || !ok(h) || !ok(ar) || !ok(v) || ar <= 0) return null;
  if (x < 0 || y < 0 || w < MIN_KEEP || h < MIN_KEEP || x + w > 1.0001 || y + h > 1.0001) return null;
  return { x, y, w, h, ar, v };
}

/**
 * Map a bbox normalised to the FULL image (detected_images, Trace highlights)
 * into the framed view. Returns null when it falls wholly outside the frame.
 */
export function bboxIntoFrame(
  b: { x: number; y: number; width: number; height: number },
  f: PageFrame,
): { x: number; y: number; width: number; height: number } | null {
  const x0 = Math.max(b.x, f.x), y0 = Math.max(b.y, f.y);
  const x1 = Math.min(b.x + b.width, f.x + f.w), y1 = Math.min(b.y + b.height, f.y + f.h);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: (x0 - f.x) / f.w, y: (y0 - f.y) / f.h, width: (x1 - x0) / f.w, height: (y1 - y0) / f.h };
}

/** Aspect ratios this close count as the same picture at another resolution. */
const AR_TOLERANCE = 0.02;

/** The frame, if it belongs to an image of this natural size; else null. */
export function frameForImage(f: PageFrame | null, naturalW: number, naturalH: number): PageFrame | null {
  if (!f || !naturalW || !naturalH) return null;
  return Math.abs(naturalW / naturalH / f.ar - 1) <= AR_TOLERANCE ? f : null;
}

/**
 * Where to draw the whole scan inside a page-sized clip of `clipW`×`clipH`
 * so that only the framed page shows (CSS pixels, relative to the clip).
 */
export function framedImageBox(clipW: number, clipH: number, f: PageFrame): { left: number; top: number; width: number; height: number } {
  const width = clipW / f.w, height = clipH / f.h;
  return { left: -f.x * width, top: -f.y * height, width, height };
}
