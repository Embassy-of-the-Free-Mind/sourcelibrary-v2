/**
 * Bounding-box normalisation for vision-model image detections — TS twin of
 * scripts/lib/bbox.mjs (scripts cannot import TS). tests/unit/bbox-parity.test.ts fails if
 * the two drift.
 *
 * PRIOR ART: src/lib/image-extraction.ts `normalizeBbox` (inline, replaced by this) —
 * src/lib/gallery-deepzoom-bbox.ts remaps an already-normalised bbox into the deep-zoom
 * master's space and does not touch model-output units.
 *
 * The WHY lives in the .mjs header: the model sometimes returns mixed 0–1 / 0–1000 units
 * in one box, and whole-box scaling turned 6% of new gallery crops into 1-pixel specks
 * (2026-09-14).
 */

export interface Bbox { x: number; y: number; width: number; height: number }

/** A box narrower or shorter than this fraction of the page is not a crop. */
export const MIN_BBOX_EXTENT = 0.005;

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

export function normalizeBbox(raw: unknown): Bbox | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  let x = num(r.x), y = num(r.y), width = num(r.width), height = num(r.height);
  const large = [x, y, width, height].filter(v => v > 1).length;

  if (large === 4) {
    // Uniformly 0–1000 (or pixel) coordinates: scale the whole box to its largest extent.
    const scale = Math.max(x + width, y + height, 1000);
    x /= scale; y /= scale; width /= scale; height /= scale;
  } else if (large > 0) {
    // Mixed units in one box: only the out-of-range fields are on the 0–1000 scale.
    if (x > 1) x /= 1000;
    if (y > 1) y /= 1000;
    if (width > 1) width /= 1000;
    if (height > 1) height /= 1000;
  }

  const out: Bbox = {
    x: Math.min(Math.max(x, 0), 0.95),
    y: Math.min(Math.max(y, 0), 0.95),
    width: Math.min(Math.max(width, 0), 1),
    height: Math.min(Math.max(height, 0), 1),
  };
  if (out.width < MIN_BBOX_EXTENT || out.height < MIN_BBOX_EXTENT) return null;
  return out;
}

/** Twin of scripts/lib/bbox.mjs normalizeRotation — see the comment there. */
export function normalizeRotation(raw: unknown): 0 | 90 | 180 | 270 | undefined {
  const n = typeof raw === 'string' ? (raw.trim() === '' ? NaN : Number(raw)) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  const q = Math.round(n / 90) * 90;
  if (Math.abs(n - q) > 5) return undefined;
  return (((q % 360) + 360) % 360) as 0 | 90 | 180 | 270;
}
