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

/** Upper bound of the tenfold scale: a non-integer raw value in (1, 10] is 0–10, not 0–1000. */
export const TENFOLD_MAX = 10;
const isInteger = (v: number): boolean => Math.abs(v - Math.round(v)) < 1e-9;
/** One out-of-range field of a MIXED box: integer → permille (÷1000); non-integer ≤ 10 → tenfold (÷10). */
export function rescaleOutOfRange(v: number): number {
  if (!(v > 1)) return v;
  if (v <= TENFOLD_MAX && !isInteger(v)) return v / 10;
  return v / 1000;
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
    // Mixed units in one box: only the out-of-range fields are rescaled. A permille value is
    // an INTEGER; a non-integer between 1 and 10 (`y: 1.33` beside `x: 0.068`) is the model
    // writing that one coordinate on a tenfold scale, and ÷1000 would leave 0.00133 — a box
    // "flush against the page edge" that no later check can tell from a real one. Measured
    // 2026-09-17 (#4780 day 4): 62 of the 725 rows the #4838 repair touched (contact-sheet
    // verified, ×100 was the illustration every time). See `rescaleOutOfRange`.
    x = rescaleOutOfRange(x); y = rescaleOutOfRange(y);
    width = rescaleOutOfRange(width); height = rescaleOutOfRange(height);
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
