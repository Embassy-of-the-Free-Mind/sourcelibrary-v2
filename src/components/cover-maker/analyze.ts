import type { Crop } from './types';

/**
 * Looking at scans in the browser: loading them canvas-safe, telling a board
 * or a marbled paper from a plain flyleaf, and finding the title block on a
 * title page. All of it is cheap pixel statistics on small copies.
 */

const loading = new Map<string, Promise<HTMLImageElement>>();

function tryLoad(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image failed: ${url}`));
    img.src = url;
  });
}

/**
 * Load an image the canvas may read back. R2 sends CORS headers; anything else
 * goes through our own /api/image proxy, which is same-origin.
 */
export function loadImage(url: string): Promise<HTMLImageElement> {
  let p = loading.get(url);
  if (!p) {
    const sameOrigin = url.startsWith('/');
    p = tryLoad(url).catch((err) => {
      if (sameOrigin) throw err;
      return tryLoad(`/api/image?url=${encodeURIComponent(url)}&w=2400&q=90`);
    });
    p.catch(() => loading.delete(url));
    loading.set(url, p);
  }
  return p;
}

function small(img: HTMLImageElement, maxW: number) {
  const sc = Math.min(1, maxW / img.naturalWidth);
  const w = Math.max(1, Math.round(img.naturalWidth * sc));
  const h = Math.max(1, Math.round(img.naturalHeight * sc));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(img, 0, 0, w, h);
  return { w, h, data: x.getImageData(0, 0, w, h).data };
}

export interface SurfaceStats {
  /** Mean luminance, 0–1. */
  lum: number;
  /** Mean HSL-ish saturation, 0–1. */
  sat: number;
  /** Luminance standard deviation: how much pattern there is. */
  busy: number;
  /** Average colour of the central area, hex. */
  color: string;
}

/** Statistics over the central 70% of a scan (the edges are often scanner bed). */
export function surfaceStats(img: HTMLImageElement): SurfaceStats {
  const { w, h, data } = small(img, 160);
  let n = 0, sl = 0, sl2 = 0, ss = 0, sr = 0, sg = 0, sb = 0;
  for (let y = Math.floor(h * 0.15); y < h * 0.85; y++) {
    for (let x = Math.floor(w * 0.15); x < w * 0.85; x++) {
      const k = (y * w + x) * 4;
      const r = data[k] / 255, g = data[k + 1] / 255, b = data[k + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      sl += l; sl2 += l * l; ss += mx === 0 ? 0 : (mx - mn) / mx;
      sr += r; sg += g; sb += b; n++;
    }
  }
  const lum = sl / n;
  const hex = (v: number) => Math.round((v / n) * 255).toString(16).padStart(2, '0');
  return { lum, sat: ss / n, busy: Math.sqrt(Math.max(0, sl2 / n - lum * lum)), color: `#${hex(sr)}${hex(sg)}${hex(sb)}` };
}

/** A rich colour from an illustration, darkened into something a cloth binding could be. */
export function clothColorFrom(img: HTMLImageElement): string | null {
  const { data } = small(img, 120);
  let n = 0, r = 0, g = 0, b = 0;
  for (let k = 0; k < data.length; k += 4) {
    const R = data[k], G = data[k + 1], B = data[k + 2];
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    if (mx < 40 || (mx - mn) / mx < 0.28) continue;
    r += R; g += G; b += B; n++;
  }
  if (n < data.length / 4 / 50) return null;
  // Keep the hue, bring the brightest channel down to cloth depth.
  const f = 105 / (Math.max(r, g, b) / n);
  const hex = (v: number) => Math.round(Math.min(255, (v / n) * f)).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function otsu(hist: number[], total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, t = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; t = i; }
  }
  return t;
}

interface InkMap { w: number; h: number; ink: Uint8Array; threshold: number }

function inkMap(img: HTMLImageElement): InkMap {
  const { w, h, data } = small(img, 420);
  const lum = new Uint8Array(w * h);
  const hist = new Array(256).fill(0);
  const x0 = Math.floor(w * 0.03), x1 = Math.ceil(w * 0.97), y0 = Math.floor(h * 0.03), y1 = Math.ceil(h * 0.97);
  let total = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4;
      const v = Math.round(0.299 * data[k] + 0.587 * data[k + 1] + 0.114 * data[k + 2]);
      lum[y * w + x] = v;
      if (x >= x0 && x < x1 && y >= y0 && y < y1) { hist[v]++; total++; }
    }
  }
  const t = otsu(hist, total);
  const ink = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) ink[y * w + x] = lum[y * w + x] < t ? 1 : 0;
  // A dark scan edge, gutter shadow or board showing past the page reads as a
  // column of ink the whole way down. Type never fills half a column; clear those.
  for (let x = x0; x < x1; x++) {
    let c = 0;
    for (let y = y0; y < y1; y++) c += ink[y * w + x];
    if (c / (y1 - y0) > 0.45) for (let y = y0; y < y1; y++) ink[y * w + x] = 0;
  }
  return { w, h, ink, threshold: t / 255 };
}

interface Block { y0: number; y1: number; mass: number }

function rowBlocks(m: InkMap, minFrac = 0.004): Block[] {
  const rows: number[] = [];
  for (let y = 0; y < m.h; y++) {
    let c = 0;
    for (let x = 0; x < m.w; x++) c += m.ink[y * m.w + x];
    rows.push(c / m.w);
  }
  const blocks: Block[] = [];
  let cur: Block | null = null;
  let gap = 0;
  rows.forEach((r, y) => {
    if (r > minFrac) {
      if (!cur) cur = { y0: y, y1: y, mass: 0 };
      cur.y1 = y; cur.mass += r; gap = 0;
    } else if (cur) {
      if (++gap > 1) { blocks.push(cur); cur = null; gap = 0; }
    }
  });
  if (cur) blocks.push(cur);
  // A long dark run is a scan edge or a rule, not type.
  return blocks.filter(b => b.y1 - b.y0 >= 2 && b.mass / (b.y1 - b.y0 + 1) < 0.6);
}

function columnsOf(m: InkMap, y0: number, y1: number): [number, number] {
  let a = m.w, b = 0;
  for (let x = 0; x < m.w; x++) {
    let c = 0;
    for (let y = y0; y <= y1; y++) c += m.ink[y * m.w + x];
    if (c / (y1 - y0 + 1) > 0.02) { a = Math.min(a, x); b = Math.max(b, x); }
  }
  return a < b ? [a, b] : [0, m.w - 1];
}

/** Share of the box that is ink. Type sits around 5–30%; a woodcut border or a
 *  dark scan edge is far denser, an empty box far sparser. */
function density(m: InkMap, x0: number, x1: number, y0: number, y1: number): number {
  let c = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) c += m.ink[y * m.w + x];
  return c / Math.max(1, (x1 - x0 + 1) * (y1 - y0 + 1));
}

function toCrop(m: InkMap, x0: number, x1: number, y0: number, y1: number, pad = 0.025): Crop {
  const x = Math.max(0, x0 / m.w - pad), y = Math.max(0, y0 / m.h - pad);
  return {
    x, y,
    w: Math.min(1, (x1 + 1) / m.w + pad) - x,
    h: Math.min(1, (y1 + 1) / m.h + pad) - y,
  };
}

/**
 * The title on a title page: usually the block of the largest type in the
 * upper half. Take the tallest line in the top 60%, then grow it through the
 * neighbouring lines set at a similar size (a two- or three-line title).
 */
export function findTitleBlock(img: HTMLImageElement): { crop: Crop; threshold: number; plausible: boolean } | null {
  const m = inkMap(img);
  const blocks = rowBlocks(m);
  if (!blocks.length) return null;
  const tall = (b: Block) => b.y1 - b.y0 + 1;
  const upper = blocks.filter(b => b.y0 < m.h * 0.6);
  const pool = upper.length ? upper : blocks;
  const seed = pool.reduce((best, b) => (tall(b) > tall(best) ? b : best), pool[0]);
  const size = tall(seed);
  let y0 = seed.y0, y1 = seed.y1;
  const idx = blocks.indexOf(seed);
  for (let k = idx - 1; k >= 0; k--) {
    const b = blocks[k];
    // Upward, smaller lines usually lead into the title ("A MONOGRAPH OF THE").
    if (y0 - b.y1 > size * 0.9 || tall(b) < size * 0.15) break;
    y0 = b.y0;
  }
  for (let k = idx + 1; k < blocks.length; k++) {
    const b = blocks[k];
    if (b.y0 - y1 > size * 0.9 || tall(b) < size * 0.55) break;
    y1 = b.y1;
  }
  const [x0, x1] = columnsOf(m, y0, y1);
  const d = density(m, x0, x1, y0, y1);
  // A title is a wide band of type, not a tall block or a solid picture.
  const plausible = d > 0.03 && d < 0.4 && (x1 - x0) > (y1 - y0) * 1.3;
  return { crop: toCrop(m, x0, x1, y0, y1), threshold: m.threshold, plausible };
}

/** Everything printed on the page, for lifting a whole title page. */
export function findInkArea(img: HTMLImageElement): { crop: Crop; threshold: number; plausible: boolean } | null {
  const m = inkMap(img);
  const blocks = rowBlocks(m);
  if (!blocks.length) return null;
  const y0 = blocks[0].y0, y1 = blocks[blocks.length - 1].y1;
  const [x0, x1] = columnsOf(m, y0, y1);
  const d = density(m, x0, x1, y0, y1);
  return { crop: toCrop(m, x0, x1, y0, y1, 0.03), threshold: m.threshold, plausible: d > 0.02 && d < 0.3 && blocks.length >= 3 };
}
