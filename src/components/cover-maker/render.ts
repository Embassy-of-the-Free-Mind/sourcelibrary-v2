import { FONTS } from './fonts';
import {
  H, W,
  type Blend, type Cover, type Crop, type Finish, type FillLayer, type ImageLayer,
  type Layer, type ShapeLayer, type TextLayer,
} from './types';

/**
 * Canvas renderer for a cover. Everything is 2D canvas, no filters (Safari's
 * ctx.filter support is too recent to rely on): blurs use the shadow trick and
 * pixel work is done by hand.
 *
 * Each layer is rendered to its own canvas at its final pixel size and cached
 * on everything except position, rotation and opacity, so dragging only
 * re-composites.
 */

export type ImageSource = HTMLImageElement | HTMLCanvasElement;
export type ImageMap = Map<string, ImageSource>;

function mk(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  return c.getContext('2d', { willReadFrequently: true })!;
}

function dims(img: ImageSource): [number, number] {
  return img instanceof HTMLImageElement ? [img.naturalWidth, img.naturalHeight] : [img.width, img.height];
}

// ─── Small LRU of rendered layer canvases ─────────────────────────────────────

const cache = new Map<string, HTMLCanvasElement>();
function cached(key: string, make: () => HTMLCanvasElement): HTMLCanvasElement {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const c = make();
  cache.set(key, c);
  while (cache.size > 80) cache.delete(cache.keys().next().value as string);
  return c;
}

export function clearRenderCache(): void {
  cache.clear();
}

// ─── Generated surfaces ───────────────────────────────────────────────────────

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const surfaces = new Map<string, HTMLCanvasElement>();

/** Greyscale surface tiles, drawn over a fill with overlay blending. */
function surface(kind: 'cloth' | 'leather' | 'paper' | 'speckle'): HTMLCanvasElement {
  const hit = surfaces.get(kind);
  if (hit) return hit;
  const size = 256;
  const c = mk(size, size);
  const x = ctx2d(c);
  const img = x.createImageData(size, size);
  const p = img.data;
  const r = rng(kind.length * 7919);
  if (kind === 'cloth') {
    // Plain weave: alternating warp and weft threads with irregular thickness.
    const warp = Array.from({ length: size }, () => r());
    const weft = Array.from({ length: size }, () => r());
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const over = ((i >> 1) + (j >> 1)) % 2 === 0;
        const thread = over ? warp[i] : weft[j];
        const v = 128 + (over ? 18 : -18) + (thread - 0.5) * 40 + (r() - 0.5) * 24;
        const k = (j * size + i) * 4;
        p[k] = p[k + 1] = p[k + 2] = v;
        p[k + 3] = 255;
      }
    }
  } else if (kind === 'leather') {
    // Grain: a few octaves of value noise, then pores.
    const grid = (n: number) => Array.from({ length: n * n }, () => r());
    const oct = [grid(8), grid(16), grid(32), grid(64)];
    const sample = (g: number[], n: number, u: number, v: number) => {
      const fx = (u / size) * n, fy = (v / size) * n;
      const x0 = Math.floor(fx) % n, y0 = Math.floor(fy) % n;
      const x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
      const tx = fx - Math.floor(fx), ty = fy - Math.floor(fy);
      const a = g[y0 * n + x0] * (1 - tx) + g[y0 * n + x1] * tx;
      const b = g[y1 * n + x0] * (1 - tx) + g[y1 * n + x1] * tx;
      return a * (1 - ty) + b * ty;
    };
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        let v = 0, amp = 0.5;
        oct.forEach((g, o) => { v += sample(g, 8 << o, i, j) * amp; amp *= 0.5; });
        v = 128 + (v - 0.47) * 140 + (r() < 0.02 ? -40 : 0);
        const k = (j * size + i) * 4;
        p[k] = p[k + 1] = p[k + 2] = v;
        p[k + 3] = 255;
      }
    }
  } else {
    for (let k = 0; k < p.length; k += 4) {
      const v = 128 + (r() - 0.5) * (kind === 'paper' ? 26 : 90);
      p[k] = p[k + 1] = p[k + 2] = v;
      p[k + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  surfaces.set(kind, c);
  return c;
}

// ─── Blur via the shadow trick ────────────────────────────────────────────────

/** `src`'s alpha, blurred by `r` px and painted in `color`. */
function soft(src: HTMLCanvasElement, r: number, color: string): HTMLCanvasElement {
  const c = mk(src.width, src.height);
  const x = ctx2d(c);
  const off = src.width + 40;
  x.shadowColor = color;
  x.shadowBlur = Math.max(0, r);
  x.shadowOffsetX = off;
  x.drawImage(src, -off, 0);
  return c;
}

// ─── Finishes ─────────────────────────────────────────────────────────────────

function metalGradient(x: CanvasRenderingContext2D, w: number, h: number, finish: Finish, color: string) {
  const g = x.createLinearGradient(0, 0, w, h);
  const stops: Record<string, string[]> = {
    gilt: ['#7d5c22', '#e8cd85', '#b08736', '#f7e6aa', '#8e6a2a', '#d9b866'],
    silver: ['#6c7077', '#e6e8ec', '#959aa2', '#f5f6f8', '#7b8088', '#cfd2d7'],
  };
  const list = stops[finish] || [shade(color, -0.35), shade(color, 0.25), color, shade(color, 0.4), shade(color, -0.25), color];
  list.forEach((s, i) => g.addColorStop(i / (list.length - 1), s));
  return g;
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))));
  const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** `m` minus itself shifted by (dx, dy): the band along one side of every edge. */
function edgeBand(m: HTMLCanvasElement, dx: number, dy: number): HTMLCanvasElement {
  const c = mk(m.width, m.height);
  const x = ctx2d(c);
  x.drawImage(m, 0, 0);
  x.globalCompositeOperation = 'destination-out';
  x.drawImage(m, dx, dy);
  return c;
}

/**
 * Give a mask (alpha = shape) a finish. Stamped finishes read as an impression:
 * light comes from the top left, so the top-left walls of the impression fall
 * into shadow and the bottom-right walls catch the light.
 */
function applyFinish(m: HTMLCanvasElement, finish: Finish, color: string, depth: number, s: number): HTMLCanvasElement {
  const w = m.width, h = m.height;
  const out = mk(w, h);
  const o = ctx2d(out);
  o.drawImage(m, 0, 0);
  o.globalCompositeOperation = 'source-in';
  if (finish === 'ink') {
    o.fillStyle = color;
    o.fillRect(0, 0, w, h);
    return out;
  }
  if (finish === 'blind') {
    o.fillStyle = 'rgba(0,0,0,0.24)';
  } else {
    o.fillStyle = metalGradient(o, w, h, finish, color);
  }
  o.fillRect(0, 0, w, h);

  if (finish !== 'blind') {
    // Foil is never perfectly even: a little speckle and wear.
    o.globalCompositeOperation = 'source-atop';
    o.globalAlpha = 0.22;
    o.fillStyle = o.createPattern(surface('speckle'), 'repeat')!;
    o.fillRect(0, 0, w, h);
    o.globalAlpha = 1;
  }

  const d = Math.max(0.6, depth * s);
  if (depth > 0) {
    const shadowBand = soft(edgeBand(m, d, d), d * 0.9, finish === 'blind' ? 'rgba(0,0,0,0.75)' : 'rgba(40,20,0,0.6)');
    const lightBand = soft(edgeBand(m, -d, -d), d * 0.7, finish === 'blind' ? 'rgba(255,250,240,0.35)' : 'rgba(255,248,225,0.6)');
    for (const band of [shadowBand, lightBand]) {
      const b = ctx2d(band);
      b.globalCompositeOperation = 'destination-in';
      b.drawImage(m, 0, 0);
      o.globalCompositeOperation = 'source-over';
      o.drawImage(band, 0, 0);
    }
  }
  return out;
}

// ─── Image layers ─────────────────────────────────────────────────────────────

/** Draw `crop` of `img` to fill a pw×ph canvas, rotated by `rot`, centre-cropping to fit. */
function cropTo(img: ImageSource, crop: Crop, rot: number, pw: number, ph: number): HTMLCanvasElement {
  const [iw, ih] = dims(img);
  const sideways = rot === 90 || rot === 270;
  const tw = sideways ? ph : pw, th = sideways ? pw : ph;
  let sx = crop.x * iw, sy = crop.y * ih, sw = crop.w * iw, sh = crop.h * ih;
  const la = tw / th, ca = sw / sh;
  if (ca > la) { const nw = sh * la; sx += (sw - nw) / 2; sw = nw; } else { const nh = sw / la; sy += (sh - nh) / 2; sh = nh; }
  const c = mk(pw, ph);
  const x = ctx2d(c);
  x.imageSmoothingQuality = 'high';
  x.translate(c.width / 2, c.height / 2);
  x.rotate((rot * Math.PI) / 180);
  x.drawImage(img, sx, sy, sw, sh, -tw / 2, -th / 2, tw, th);
  return c;
}

function imageContent(L: ImageLayer, img: ImageSource, s: number, srcKey: string): HTMLCanvasElement {
  const pw = Math.round(L.w * s), ph = Math.round(L.h * s);
  const key = JSON.stringify([srcKey, pw, ph, L.crop, L.srcRot, L.treatment, L.color, L.threshold, L.softness, L.invert, L.brightness, L.contrast, L.saturation, L.depth, s]);
  return cached(key, () => {
    const c = cropTo(img, L.crop, L.srcRot, pw, ph);
    const x = ctx2d(c);
    const data = x.getImageData(0, 0, c.width, c.height);
    const p = data.data;
    const br = L.brightness * 255;
    const k = Math.tan(((L.contrast + 1) * Math.PI) / 4);
    const sat = 1 + L.saturation;
    const lo = (L.threshold - L.softness / 2) * 255, hi = (L.threshold + L.softness / 2) * 255;
    const mask = L.treatment !== 'photo';
    for (let i = 0; i < p.length; i += 4) {
      let r = (p[i] - 128) * k + 128 + br;
      let g = (p[i + 1] - 128) * k + 128 + br;
      let b = (p[i + 2] - 128) * k + 128 + br;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (mask) {
        const v = L.invert ? 255 - lum : lum;
        const a = hi <= lo ? (v < lo ? 1 : 0) : Math.max(0, Math.min(1, (hi - v) / (hi - lo)));
        p[i] = p[i + 1] = p[i + 2] = 0;
        p[i + 3] = p[i + 3] * a;
      } else {
        r = lum + (r - lum) * sat; g = lum + (g - lum) * sat; b = lum + (b - lum) * sat;
        p[i] = r; p[i + 1] = g; p[i + 2] = b;
      }
    }
    x.putImageData(data, 0, 0);
    return mask ? applyFinish(c, L.treatment as Finish, L.color, L.depth, s) : c;
  });
}

// ─── Text layers ──────────────────────────────────────────────────────────────

function fontString(L: TextLayer, s: number): string {
  return `${L.italic ? 'italic ' : ''}${L.weight} ${L.size * s}px ${FONTS[L.font].family}`;
}

function spacedWidth(x: CanvasRenderingContext2D, t: string, track: number): number {
  return x.measureText(t).width + Math.max(0, [...t].length - 1) * track;
}

let measureCtx: CanvasRenderingContext2D | null = null;

/** Lines of a text layer after wrapping, at board scale. Shared by render and editor. */
export function layoutText(L: TextLayer, s = 1): { lines: string[]; lineH: number; height: number } {
  if (!measureCtx) measureCtx = ctx2d(mk(4, 4));
  const x = measureCtx;
  x.font = fontString(L, s);
  const track = L.tracking * L.size * s;
  const maxW = L.w * s;
  const text = L.caps ? L.text.toUpperCase() : L.text;
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(''); continue; }
    let line = words[0];
    for (const word of words.slice(1)) {
      const next = `${line} ${word}`;
      if (spacedWidth(x, next, track) <= maxW) line = next;
      else { lines.push(line); line = word; }
    }
    lines.push(line);
  }
  const lineH = L.size * L.leading * s;
  return { lines, lineH, height: Math.max(lineH, lines.length * lineH) };
}

function textContent(L: TextLayer, s: number): HTMLCanvasElement {
  const { lines, lineH, height } = layoutText(L, s);
  const pw = Math.round(L.w * s), ph = Math.round(height);
  const key = JSON.stringify(['t', pw, ph, L.text, L.font, L.size, L.weight, L.italic, L.caps, L.tracking, L.leading, L.align, L.finish, L.color, L.depth, s]);
  return cached(key, () => {
    const m = mk(pw, ph);
    const x = ctx2d(m);
    x.font = fontString(L, s);
    x.textBaseline = 'alphabetic';
    x.fillStyle = '#000';
    const track = L.tracking * L.size * s;
    lines.forEach((line, i) => {
      const lw = spacedWidth(x, line, track);
      let cx = L.align === 'left' ? 0 : L.align === 'right' ? pw - lw : (pw - lw) / 2;
      const y = i * lineH + lineH * 0.5 + L.size * s * 0.34;
      if (!track) { x.fillText(line, cx, y); return; }
      for (const ch of line) { x.fillText(ch, cx, y); cx += x.measureText(ch).width + track; }
    });
    return applyFinish(m, L.finish, L.color, L.depth, s);
  });
}

// ─── Shapes and fills ─────────────────────────────────────────────────────────

function shapeContent(L: ShapeLayer, s: number): HTMLCanvasElement {
  const pw = Math.round(L.w * s), ph = Math.round(L.h * s);
  const key = JSON.stringify(['s', pw, ph, L.shape, L.stroke, L.finish, L.color, L.depth, s]);
  return cached(key, () => {
    const m = mk(pw, ph);
    const x = ctx2d(m);
    const sw = Math.max(1, L.stroke * s);
    x.strokeStyle = x.fillStyle = '#000';
    x.lineWidth = sw;
    if (L.shape === 'frame' || L.shape === 'double-frame') {
      x.strokeRect(sw / 2, sw / 2, pw - sw, ph - sw);
      if (L.shape === 'double-frame') {
        const g = sw * 3.5;
        x.lineWidth = Math.max(1, sw * 0.5);
        x.strokeRect(g, g, pw - g * 2, ph - g * 2);
      }
    } else if (L.shape === 'oval') {
      x.beginPath();
      x.ellipse(pw / 2, ph / 2, Math.max(1, pw / 2 - sw), Math.max(1, ph / 2 - sw), 0, 0, Math.PI * 2);
      x.stroke();
    } else {
      x.fillRect(0, 0, pw, ph);
    }
    const out = applyFinish(m, L.shape === 'panel' ? 'blind' : L.finish, L.color, L.depth, s);
    if (L.shape === 'label') {
      // A pasted paper label: give it a little paper surface and a hairline border.
      const o = ctx2d(out);
      o.globalCompositeOperation = 'source-atop';
      o.globalAlpha = 0.25;
      o.fillStyle = o.createPattern(surface('paper'), 'repeat')!;
      o.fillRect(0, 0, pw, ph);
      o.globalAlpha = 0.5;
      o.strokeStyle = shade(L.color, -0.45);
      o.lineWidth = Math.max(1, s * 2);
      o.strokeRect(sw * 2, sw * 2, pw - sw * 4, ph - sw * 4);
    }
    return out;
  });
}

function fillPath(x: CanvasRenderingContext2D, L: FillLayer, s: number) {
  x.beginPath();
  if (L.region === 'spine') {
    x.rect(0, 0, W * 0.26 * s, H * s);
  } else if (L.region === 'corners') {
    const c = W * 0.2 * s;
    const w = W * s, h = H * s;
    x.moveTo(w - c, 0); x.lineTo(w, 0); x.lineTo(w, c); x.closePath();
    x.moveTo(w - c, h); x.lineTo(w, h); x.lineTo(w, h - c); x.closePath();
  } else {
    x.rect(0, 0, W * s, H * s);
  }
}

function drawFill(x: CanvasRenderingContext2D, L: FillLayer, s: number) {
  x.save();
  x.globalAlpha = L.opacity;
  x.globalCompositeOperation = blendOp(L.blend);
  fillPath(x, L, s);
  x.fillStyle = L.color;
  x.fill();
  if (L.texture !== 'none') {
    const pat = x.createPattern(surface(L.texture), 'repeat')!;
    pat.setTransform(new DOMMatrix().scale(L.texture === 'cloth' ? s * 1.2 : s * 2.2));
    x.globalCompositeOperation = 'overlay';
    x.globalAlpha = L.opacity * (L.texture === 'paper' ? 0.5 : 0.8);
    x.fillStyle = pat;
    x.fill();
  }
  if (L.region !== 'all') {
    // The turned-in edge of a leather spine or corner throws a soft line onto the board.
    x.globalCompositeOperation = 'source-over';
    x.globalAlpha = 0.35;
    x.strokeStyle = '#000';
    x.lineWidth = 3 * s;
    x.stroke();
  }
  x.restore();
}

function blendOp(b: Blend): GlobalCompositeOperation {
  return b === 'normal' ? 'source-over' : b;
}

// ─── Board ────────────────────────────────────────────────────────────────────

export function layerCanvas(L: Layer, s: number, images: ImageMap): HTMLCanvasElement | null {
  if (L.kind === 'image') {
    const img = images.get(L.src);
    return img ? imageContent(L, img, s, L.src + dims(img).join('x')) : null;
  }
  if (L.kind === 'text') return textContent(L, s);
  if (L.kind === 'shape') return shapeContent(L, s);
  return null;
}

/** Board-unit height of a layer as drawn (text layers size themselves). */
export function layerHeight(L: Layer): number {
  return L.kind === 'text' ? layoutText(L).height : L.h;
}

/**
 * Render a cover onto `x`, whose canvas is W*s × H*s pixels. `images` maps each
 * layer `src` to a loaded image; layers whose image hasn't arrived are skipped.
 */
export function renderCover(x: CanvasRenderingContext2D, cover: Cover, s: number, images: ImageMap): void {
  x.save();
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.clearRect(0, 0, x.canvas.width, x.canvas.height);
  x.fillStyle = '#3a332b';
  x.fillRect(0, 0, x.canvas.width, x.canvas.height);
  for (const L of cover.layers) {
    if (L.hidden) continue;
    if (L.kind === 'fill') { drawFill(x, L, s); continue; }
    const c = layerCanvas(L, s, images);
    if (!c) continue;
    x.save();
    x.globalAlpha = L.opacity;
    x.globalCompositeOperation = blendOp(L.blend);
    x.translate(L.x * s, L.y * s);
    x.rotate((L.rot * Math.PI) / 180);
    x.drawImage(c, -c.width / 2, -c.height / 2);
    x.restore();
  }
  // The board itself: a faint vignette where it was handled and the edges rounded.
  const g = x.createRadialGradient(W * s * 0.5, H * s * 0.45, W * s * 0.3, W * s * 0.5, H * s * 0.5, H * s * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.18)');
  x.fillStyle = g;
  x.globalCompositeOperation = 'source-over';
  x.fillRect(0, 0, W * s, H * s);
  x.restore();
}
