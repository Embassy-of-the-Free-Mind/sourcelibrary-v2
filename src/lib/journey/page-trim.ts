/**
 * Find the page inside a scan that also shows the dark scanner bed around it.
 *
 * Many scans (Digital Library of India, older Internet Archive captures) show a
 * black or near-black strip beside the leaf. The journey film enlarges one page
 * to fill the frame, so that strip reads as part of the book. This trims dark
 * bands from each edge, judged against the page's own brightness, and returns
 * the box to keep. It only removes bands DARKER than the page — white canvas
 * margins (#4276) are a different problem and are left alone.
 *
 * PRIOR ART: scripts/maintenance/recrop-bph-gutter.mjs — re-crops stored BPH
 * images at a gutter, server-side; this is a display-only trim with no write.
 */

export interface TrimBox { x: number; y: number; w: number; h: number }

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

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

/**
 * `lum` is a row-major luminance array (0–255) of a `w`×`h` image, usually a
 * downsampled copy. Returns the box to keep in the same pixel space, or null
 * when nothing worth trimming was found (or the result looks wrong).
 */
export function findPageBox(lum: ArrayLike<number>, w: number, h: number): TrimBox | null {
  if (w < 8 || h < 8) return null;
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
  const thr = ref * DARK_RATIO;
  if (ref < 40) return null; // a dark page overall: no contrast to judge a border by

  // Scanners often leave a thin bright sliver OUTSIDE the dark bed, so walking in
  // from the edge stops at once. Instead look for the innermost dark run within
  // the outer EDGE_ZONE of each side and cut just past it.
  const cutFrom = (m: number[], fromEnd: boolean): number => {
    const n = m.length, zone = Math.floor(n * EDGE_ZONE), minRun = Math.max(2, Math.round(n * MIN_RUN));
    let cut = fromEnd ? n - 1 : 0, run = 0;
    for (let i = 0; i < zone; i++) {
      const k = fromEnd ? n - 1 - i : i;
      if (m[k] < thr) {
        run++;
        if (run >= minRun) cut = fromEnd ? k - 1 : k + 1;
      } else run = 0;
    }
    // A run still open at the zone's edge continues inward: not a border.
    if (run > 0 && run >= minRun) return fromEnd ? n - 1 : 0;
    return cut;
  };
  let l = cutFrom(col, false), r = cutFrom(col, true), t = cutFrom(row, false), b = cutFrom(row, true);
  if (l === 0 && r === w - 1 && t === 0 && b === h - 1) return null;

  // Step past the shadow ramp only on the sides that actually had a border.
  const ix = Math.round(w * INSET), iy = Math.round(h * INSET);
  if (l > 0) l += ix;
  if (r < w - 1) r -= ix;
  if (t > 0) t += iy;
  if (b < h - 1) b -= iy;

  const box = { x: l, y: t, w: r - l + 1, h: b - t + 1 };
  if (box.w < w * MIN_KEEP || box.h < h * MIN_KEEP) return null;
  return box;
}

/**
 * Browser only: draw `im` cropped to its page. Returns the original image when
 * there is nothing to trim or the pixels cannot be read (a tainted canvas).
 */
export function trimImage(im: HTMLImageElement): HTMLImageElement | HTMLCanvasElement {
  const W = im.naturalWidth, H = im.naturalHeight;
  if (!W || !H) return im;
  try {
    const s = Math.min(1, 256 / Math.max(W, H));
    const sw = Math.max(1, Math.round(W * s)), sh = Math.max(1, Math.round(H * s));
    const probe = document.createElement('canvas');
    probe.width = sw; probe.height = sh;
    const pg = probe.getContext('2d', { willReadFrequently: true });
    if (!pg) return im;
    pg.drawImage(im, 0, 0, sw, sh);
    const px = pg.getImageData(0, 0, sw, sh).data;
    const lum = new Uint8ClampedArray(sw * sh);
    for (let i = 0; i < lum.length; i++) lum[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    const box = findPageBox(lum, sw, sh);
    if (!box) return im;
    const x = Math.round(box.x / s), y = Math.round(box.y / s);
    const w = Math.min(W - x, Math.round(box.w / s)), h = Math.min(H - y, Math.round(box.h / s));
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    out.getContext('2d')?.drawImage(im, x, y, w, h, 0, 0, w, h);
    return out;
  } catch {
    return im;
  }
}
