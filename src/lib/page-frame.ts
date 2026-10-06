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

/** 1: one cut per side from whole-image means. 2: the innermost edge of a tilted
 *  page, so no wedge of bed shows beside it. 3: bed must reach the image edge, so
 *  a dark printed band behind a paper margin (a headpiece, a heavy rule) is kept. */
export const PAGE_FRAME_VERSION = 3;

/** Box in pixels of the analysed (usually downsampled) image. */
export interface PixelBox { x: number; y: number; w: number; h: number }

export type FrameVerdict =
  | { kind: 'frame'; box: PixelBox }
  | { kind: 'clean' }
  | { kind: 'skip'; reason: 'dark-page' | 'too-much' | 'multi-leaf' | 'tiny' | 'not-a-page' | 'printing-at-edge' };

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
/** Bed reaches the image edge. A dark band behind more than this much PAGE-LIKE
 *  margin (profile within PAGE_TOLERANCE of the page's brightness) is the page's
 *  own printing: a headpiece, a heavy rule. Rulers, colour charts and the pure
 *  white strips some scanners add are not page-like and do not count. */
const MAX_GAP = 0.04;
const PAGE_TOLERANCE = 0.12;
/** How far past each cut the pixels are checked for printing (fraction of size). */
const CHECK_DEPTH = 0.04;
/** Above this share of lines showing printing past a cut, the frame is refused. */
const MAX_PRINTED_LINES = 0.15;
/** The strip just inside each cut must be clean paper: above this share of lines
 *  with ink in it, the cut is slicing letters (text that runs up to the bed). */
const MAX_INKED_LINES = 0.1;
const CUT_STRIP = 0.01;
/** An image narrower than this (w/h) is a spine or an edge, not a page; a tall
 *  octavo is ~0.6. Its "bed" is the spine's own ends and label. */
const MIN_PAGE_AR = 0.4;
/** Trimming less than this fraction of the area is not worth a frame. */
const MIN_TRIM_AREA = 0.02;
/** Bands along each side, so a tilted page edge is found where it comes furthest in. */
const BANDS = 6;
/** Most tilt the innermost-edge cut will follow (tan 3°); more than that is not a straight edge. */
const MAX_TILT = 0.052;
/** The innermost-edge cut also clears the grey shadow where a page edge lifts off the bed. */
const SHADOW_RATIO = 0.8;
/** Paper the tighter cut removes must be this bright (fraction of the page median): blank, no ink. */
const BLANK_RATIO = 0.9;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

/**
 * Innermost cut past the bed on one side: the dark bands that run in from the
 * image edge, within EDGE_ZONE, with no more than MAX_GAP of page-like margin
 * outside or between them.
 */
function cutFrom(m: number[], thr: number, fromEnd: boolean, ref: number): number {
  const n = m.length, zone = Math.floor(n * EDGE_ZONE), minRun = Math.max(2, Math.round(n * MIN_RUN));
  const maxGap = Math.max(1, Math.round(n * MAX_GAP));
  let cut = fromEnd ? n - 1 : 0, run = 0, paper = 0;
  for (let i = 0; i < zone; i++) {
    const k = fromEnd ? n - 1 - i : i;
    if (m[k] < thr) {
      run++;
      // Scanners often leave a thin bright sliver OUTSIDE the bed, so the cut is
      // the innermost qualifying run, not the first bright column from the edge.
      if (run >= minRun) { cut = fromEnd ? k - 1 : k + 1; paper = 0; }
    } else {
      run = 0;
      // Past a real paper margin, a dark band is the page's own printing.
      if (Math.abs(m[k] - ref) <= ref * PAGE_TOLERANCE && ++paper > maxGap) break;
    }
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
 * A scan is often slightly tilted, so the bed shows as a wedge: wide at one end
 * of a side, absent at the other. A cut from whole-side means lands mid-slope and
 * leaves a triangle of bed. This moves the cut to where the edge comes furthest
 * in, measured per band, but only when the paper it gives up is blank and the
 * slope is one a straight edge could have. Otherwise the cut stays where it was.
 *
 * `profile(lo, hi)` gives the mean across the band [lo, hi] of the other axis for
 * every position along this one; `span` is that other axis's [a, b]; `at(k, j)`
 * is the pixel at position k along this axis and j along the other.
 */
function innermostCut(
  cut: number, fromEnd: boolean, thr: number, ref: number,
  span: [number, number], profile: (lo: number, hi: number) => number[],
  at: (k: number, j: number) => number,
): number {
  const [a, b] = span;
  const pad = Math.round((b - a) * 0.04), len = b - a - 2 * pad;
  if (len < BANDS * 2) return cut;
  const bands: number[][] = [];
  for (let i = 0; i < BANDS; i++) {
    const lo = a + pad + Math.floor((len * i) / BANDS), hi = a + pad + Math.floor((len * (i + 1)) / BANDS) - 1;
    bands.push(profile(lo, hi));
  }
  const n = bands[0].length, outer = fromEnd ? n - 1 : 0;
  const centre = (i: number) => a + pad + (len * (i + 0.5)) / BANDS;
  // Bands where the bed shows. Their edges lie on a line; a band mean smears it,
  // so fit the line and take its innermost end over the whole span.
  const pts = bands.map((m, i) => [centre(i), cutFrom(m, ref * SHADOW_RATIO, fromEnd, ref)]).filter(([, c]) => c !== outer);
  if (pts.length === 0) return cut;
  let deepest = fromEnd ? Math.min(...pts.map(p => p[1])) : Math.max(...pts.map(p => p[1]));
  if (pts.length >= 2) {
    const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length, my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const sxx = pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
    const slope = sxx ? pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / sxx : 0;
    const ends = [a, b].map(z => Math.round(my + slope * (z - mx)));
    deepest = fromEnd ? Math.min(deepest, ...ends) : Math.max(deepest, ...ends);
  }
  const inner = fromEnd ? Math.min(cut, deepest) : Math.max(cut, deepest);
  if (inner === cut) return cut;
  if (Math.abs(inner - cut) > Math.ceil(MAX_TILT * (b - a))) return cut;
  // What is given up must be bed or blank paper. Along each line, walk inward from
  // the old cut: the bed (and its shadow ramp) runs into it from outside; past that, any pixel as
  // dark as the bed is ink, and the paper must average clean.
  const step = fromEnd ? -1 : 1;
  for (let j = a; j <= b; j++) {
    let k = cut;
    // Only a dark run that continues outward past the old cut is bed.
    const out = cut - step;
    if (out < 0 || out >= n || at(out, j) < ref * BLANK_RATIO) {
      while (k !== inner && at(k, j) < ref * BLANK_RATIO) k += step;
    }
    let sum = 0, cnt = 0;
    for (; k !== inner; k += step) {
      const v = at(k, j);
      if (v < thr) return cut;
      sum += v; cnt++;
    }
    if (cnt && sum / cnt < ref * BLANK_RATIO) return cut;
  }
  return inner;
}

/**
 * `lum` is a row-major luminance array (0–255) of a `w`×`h` image, usually a
 * copy downsampled to ~256px on the long side.
 */
export function detectPageFrame(lum: ArrayLike<number>, w: number, h: number): FrameVerdict {
  if (w < 16 || h < 16) return { kind: 'skip', reason: 'tiny' };
  if (w / h < MIN_PAGE_AR) return { kind: 'skip', reason: 'not-a-page' };
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

  let l = cutFrom(col, thr, false, ref), r = cutFrom(col, thr, true, ref);
  let t = cutFrom(row, thr, false, ref), b = cutFrom(row, thr, true, ref);

  // Column means over the rows [y0, y1], and row means over the columns [x0, x1].
  const colsOver = (y0: number, y1: number) => {
    const m = new Array<number>(w).fill(0);
    for (let y = y0; y <= y1; y++) for (let x = 0; x < w; x++) m[x] += lum[y * w + x];
    return m.map(v => v / (y1 - y0 + 1));
  };
  const rowsOver = (x0: number, x1: number) => {
    const m = new Array<number>(h).fill(0);
    for (let y = 0; y < h; y++) for (let x = x0; x <= x1; x++) m[y] += lum[y * w + x];
    return m.map(v => v / (x1 - x0 + 1));
  };
  const atX = (x: number, y: number) => lum[y * w + x], atY = (y: number, x: number) => lum[y * w + x];
  l = innermostCut(l, false, thr, ref, [t, b], colsOver, atX);
  r = innermostCut(r, true, thr, ref, [t, b], colsOver, atX);
  t = innermostCut(t, false, thr, ref, [l, r], rowsOver, atY);
  b = innermostCut(b, true, thr, ref, [l, r], rowsOver, atY);

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

  if (printingPastCut(lum, w, h, box, ref, thr) || inkAtCut(lum, w, h, box, thr)) {
    return { kind: 'skip', reason: 'printing-at-edge' };
  }
  return { kind: 'frame', box };
}

/**
 * The last check, on pixels rather than means. Walking outward from each cut,
 * bed is solid dark, and blank paper may come before it; ink followed by paper
 * is printing (a column of text, an engraving, a rule between columns) that a
 * profile mistook for bed. If enough lines along any side show that, the page is
 * shown whole: a refused frame costs a dark strip, a wrong one costs the text.
 */
function printingPastCut(lum: ArrayLike<number>, w: number, h: number, box: PixelBox, ref: number, thr: number): boolean {
  const bright = ref * 0.85;
  // [cut position, outward step, image size along the walk, line count, pixel(i along walk, j along side)]
  const sides: Array<[number, number, number, number, (i: number, j: number) => number]> = [];
  const x0 = box.x, x1 = box.x + box.w - 1, y0 = box.y, y1 = box.y + box.h - 1;
  if (x0 > 0) sides.push([x0 - 1, -1, w, box.h, (i, j) => lum[(y0 + j) * w + i]]);
  if (x1 < w - 1) sides.push([x1 + 1, 1, w, box.h, (i, j) => lum[(y0 + j) * w + i]]);
  if (y0 > 0) sides.push([y0 - 1, -1, h, box.w, (i, j) => lum[i * w + x0 + j]]);
  if (y1 < h - 1) sides.push([y1 + 1, 1, h, box.w, (i, j) => lum[i * w + x0 + j]]);
  for (const [start, step, n, lines, at] of sides) {
    const depth = Math.max(2, Math.round(n * CHECK_DEPTH)), sliver = Math.round(n * 0.02);
    let printed = 0;
    for (let j = 0; j < lines; j++) {
      let dark = false;
      for (let d = 0, i = start; d < depth && i >= sliver && i < n - sliver; d++, i += step) {
        const v = at(i, j);
        if (v < thr) dark = true;
        else if (dark && v >= bright) { printed++; break; }
      }
    }
    if (printed > lines * MAX_PRINTED_LINES) return true;
  }
  return false;
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

/** True when the strip just inside a cut side holds ink on too many lines. */
function inkAtCut(lum: ArrayLike<number>, w: number, h: number, box: PixelBox, thr: number): boolean {
  const x0 = box.x, x1 = box.x + box.w - 1, y0 = box.y, y1 = box.y + box.h - 1;
  const dx = Math.max(2, Math.round(w * CUT_STRIP)), dy = Math.max(2, Math.round(h * CUT_STRIP));
  // [is this side cut, lines along it, pixel(line, depth inward)]
  const sides: Array<[boolean, number, number, (j: number, d: number) => number]> = [
    [x0 > 0, box.h, dx, (j, d) => lum[(y0 + j) * w + x0 + d]],
    [x1 < w - 1, box.h, dx, (j, d) => lum[(y0 + j) * w + x1 - d]],
    [y0 > 0, box.w, dy, (j, d) => lum[(y0 + d) * w + x0 + j]],
    [y1 < h - 1, box.w, dy, (j, d) => lum[(y1 - d) * w + x0 + j]],
  ];
  for (const [cut, lines, depth, at] of sides) {
    if (!cut) continue;
    const dark: boolean[] = [];
    for (let j = 0; j < lines; j++) {
      let hit = false;
      for (let d = 0; d < depth && !hit; d++) hit = at(j, d) < thr;
      dark.push(hit);
    }
    // Sliced letters meet the cut in short dashes, one per line of text; leftover
    // bed or its shadow runs along it unbroken. Count only the short runs.
    const longRun = Math.max(3, Math.round(lines * 0.04));
    let inked = 0;
    for (let j = 0; j < lines;) {
      if (!dark[j]) { j++; continue; }
      let k = j;
      while (k < lines && dark[k]) k++;
      if (k - j < longRun) inked += k - j;
      j = k;
    }
    if (inked > lines * MAX_INKED_LINES) return true;
  }
  return false;
}
