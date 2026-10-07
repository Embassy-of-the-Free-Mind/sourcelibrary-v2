import { layerHeight, type ImageMap } from './render';
import { H, W, type Crop, type ImageLayer, type Layer } from './types';

/**
 * Board geometry for direct manipulation: local/world transforms, bounding
 * boxes, snapping candidates, and the crop arithmetic that lets a picture's
 * edges be dragged out to reveal more of its page.
 */

export interface Pt { x: number; y: number }
export interface Box { l: number; t: number; r: number; b: number }

const rad = (deg: number) => (deg * Math.PI) / 180;

export function rotate(p: Pt, deg: number): Pt {
  const a = rad(deg), c = Math.cos(a), s = Math.sin(a);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

export function toLocal(p: Pt, L: Layer): Pt {
  return rotate({ x: p.x - L.x, y: p.y - L.y }, -L.rot);
}

export function toWorld(p: Pt, L: Layer): Pt {
  const r = rotate(p, L.rot);
  return { x: L.x + r.x, y: L.y + r.y };
}

export function aabb(L: Layer): Box {
  const h = layerHeight(L);
  const pts = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => toWorld({ x: (sx * L.w) / 2, y: (sy * h) / 2 }, L));
  return {
    l: Math.min(...pts.map(p => p.x)), r: Math.max(...pts.map(p => p.x)),
    t: Math.min(...pts.map(p => p.y)), b: Math.max(...pts.map(p => p.y)),
  };
}

// ─── Snapping ─────────────────────────────────────────────────────────────────

export interface Targets { xs: number[]; ys: number[] }

/**
 * Lines a moving layer can snap to: the board's edges and centre lines, every
 * other layer's edges and centre, and each of those edges mirrored across the
 * board, so a layer can take the same margin on the right as another has on
 * the left.
 */
export function snapTargets(layers: Layer[], movingId: string): Targets {
  const xs = [0, W / 2, W], ys = [0, H / 2, H];
  for (const L of layers) {
    if (L.id === movingId || L.hidden || L.kind === 'fill') continue;
    if (L.kind === 'image' && L.w >= W - 1 && L.h >= H - 1) continue; // a full-board ground
    const b = aabb(L);
    xs.push(b.l, (b.l + b.r) / 2, b.r, W - b.l, W - b.r);
    ys.push(b.t, (b.t + b.b) / 2, b.b, H - b.t, H - b.b);
  }
  return { xs, ys };
}

/** Best snap of any of `vals` onto `targets` within `thr`: the shift to apply and the line. */
export function snap(vals: number[], targets: number[], thr: number): { d: number; at: number } | null {
  let best: { d: number; at: number } | null = null;
  for (const v of vals) {
    for (const t of targets) {
      const d = t - v;
      if (Math.abs(d) <= thr && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t };
    }
  }
  return best;
}

// ─── Crops ────────────────────────────────────────────────────────────────────

export function imageDims(L: ImageLayer, images: ImageMap): [number, number] | null {
  const img = images.get(L.src);
  if (!img) return null;
  return img instanceof HTMLImageElement ? [img.naturalWidth, img.naturalHeight] : [img.width, img.height];
}

const sideways = (L: ImageLayer) => L.srcRot === 90 || L.srcRot === 270;

/** The part of the page actually shown: the crop after it is centre-fitted to the layer's shape. */
export function effectiveCrop(L: ImageLayer, iw: number, ih: number): Crop {
  const tw = sideways(L) ? L.h : L.w, th = sideways(L) ? L.w : L.h;
  const c = { ...L.crop };
  const sw = c.w * iw, sh = c.h * ih;
  const la = tw / th, ca = sw / sh;
  if (ca > la) { const nw = (sh * la) / iw; c.x += (c.w - nw) / 2; c.w = nw; } else { const nh = (sw / la) / ih; c.y += (c.h - nh) / 2; c.h = nh; }
  return c;
}

type Edge = 'n' | 's' | 'e' | 'w';

/** Which edge of the page lies under a given edge of the layer, after `srcRot`. */
const SRC_EDGE: Record<number, Record<Edge, Edge>> = {
  0: { n: 'n', e: 'e', s: 's', w: 'w' },
  90: { e: 'n', s: 'e', w: 's', n: 'w' },
  180: { e: 'w', w: 'e', n: 's', s: 'n' },
  270: { e: 's', s: 'w', w: 'n', n: 'e' },
};

/**
 * Drag one edge of a picture outward (delta > 0) or inward, in board units,
 * changing how much of the page it shows. Returns the new crop and the delta
 * actually applied (it stops at the page edge).
 */
export function cropEdge(L: ImageLayer, c0: Crop, edge: Edge, delta: number): { crop: Crop; delta: number } {
  const horiz = edge === 'e' || edge === 'w';
  const span = horiz ? L.w : L.h;
  const frac = horiz ? (sideways(L) ? c0.h : c0.w) : (sideways(L) ? c0.w : c0.h);
  const perUnit = frac / span; // page fraction per board unit
  let dF = delta * perUnit;
  const c = { ...c0 };
  const src = SRC_EDGE[L.srcRot][edge];
  const min = 0.01;
  if (src === 'e') { dF = Math.max(min - c.w, Math.min(1 - c.x - c.w, dF)); c.w += dF; }
  if (src === 'w') { dF = Math.max(min - c.w, Math.min(c.x, dF)); c.x -= dF; c.w += dF; }
  if (src === 's') { dF = Math.max(min - c.h, Math.min(1 - c.y - c.h, dF)); c.h += dF; }
  if (src === 'n') { dF = Math.max(min - c.h, Math.min(c.y, dF)); c.y -= dF; c.h += dF; }
  return { crop: c, delta: dF / perUnit };
}

/**
 * Where a board point falls on the picture's page (0–1 of page width and
 * height), and how much page width one board unit covers. Used by the eraser.
 */
export function boardToPage(L: ImageLayer, p: Pt, iw: number, ih: number): { x: number; y: number; perUnit: number } {
  const c = effectiveCrop(L, iw, ih);
  const tw = sideways(L) ? L.h : L.w, th = sideways(L) ? L.w : L.h;
  const q = rotate(toLocal(p, L), -L.srcRot);
  return { x: c.x + ((q.x + tw / 2) / tw) * c.w, y: c.y + ((q.y + th / 2) / th) * c.h, perUnit: c.w / tw };
}

/** Slide the page under a fixed frame by a board-unit delta in the layer's own axes. */
export function panCrop(L: ImageLayer, c0: Crop, iw: number, ih: number, du: number, dv: number): Crop {
  const tw = sideways(L) ? L.h : L.w;
  const s = tw / (c0.w * iw); // board units per page pixel
  const d = rotate({ x: du, y: dv }, -L.srcRot);
  return {
    ...c0,
    x: Math.max(0, Math.min(1 - c0.w, c0.x - d.x / s / iw)),
    y: Math.max(0, Math.min(1 - c0.h, c0.y - d.y / s / ih)),
  };
}
