/**
 * Bounding-box normalisation for vision-model image detections.
 *
 * PRIOR ART: four inline copies of `normalizeBbox` — scripts/workers/image-extract-worker.mjs,
 * scripts/workers/batch-collector.mjs, scripts/maintenance/reextract-missed-pages.mjs and
 * src/lib/image-extraction.ts — all with the same defect; this file replaces the three .mjs
 * copies and src/lib/bbox.ts is its TS twin (tests/unit/bbox-parity.test.ts keeps them equal).
 *
 * WHY THIS EXISTS
 * ---------------
 * The prompt asks for 0–1 fractions; the model sometimes answers in 0–1000 (or pixels).
 * The old normaliser handled that by scaling ALL FOUR fields whenever ANY field was > 1.
 * Measured 2026-09-14 on the body-techniques books: the model also returns MIXED units in
 * one box — `{x: 0.498, y: 290, width: 0.192, height: 0.115}` — and whole-box scaling then
 * turned the three fractional fields into `0.000498 / 0.000192 / 0.000115`: a 1×1-pixel
 * crop that still passed every downstream filter (bbox present, gallery_quality ≥ 0.5).
 * 43 of 727 new gallery rows (6%) and 198 of 2,768 rows written corpus-wide in the previous
 * week carried such a box. The gallery renders a blown-up speck for each.
 *
 * Rule: units are decided PER FIELD. A value ≤ 1 is already a fraction and is never
 * rescaled; a value > 1 is on the 0–1000 scale. When every field is > 1 the old whole-box
 * scale is kept (it also copes with pixel coordinates by scaling to the largest extent).
 * A box that ends up degenerate (width or height below MIN_EXTENT) is returned as null so
 * the "bbox required" filters drop it instead of publishing a speck.
 *
 * THE BAND THE SPECK REPAIR MISSED (#4780 day 4, 2026-09-17)
 * ---------------------------------------------------------
 * The model has a third unit: ONE coordinate on a tenfold scale (`y: 1.33` for 0.133, beside
 * three fractions). Whole-box ÷1000 stored it as 0.00133 — not a speck (the threshold is
 * MIN_BBOX_EXTENT / 5 = 0.001), so `repairMixedUnitBbox` restored the three specks beside it
 * and, by its own rule, left the lone small y as "a box flush against the page edge". The
 * crops were shifted up and cut at the bottom (Boethius' fold-out plate 30% blank on top). The
 * tell is arithmetic, not visual: a permille coordinate is an INTEGER, a tenfold one is not.
 * `rescaleOutOfRange` applies it live (a non-integer raw in (1, 10] is ÷10) and
 * `repairTenfoldResidual` applies it to stored boxes (a non-integer-permille value in
 * (0.001, 0.01] is ×100, when the result stays inside the page). Measured: 62 of the 725 rows
 * the 09-14 repair touched, every one confirmed by contact sheet; 0 integer cases among them.
 */

/** A box narrower or shorter than this fraction of the page is not a crop. */
export const MIN_BBOX_EXTENT = 0.005;

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {{x:any,y:any,width:any,height:any}|null|undefined} raw
 * @returns {{x:number,y:number,width:number,height:number}|null}
 */
/** Upper bound of the tenfold scale: a non-integer raw value in (1, 10] is 0–10, not 0–1000. */
export const TENFOLD_MAX = 10;
const isInteger = (v) => Math.abs(v - Math.round(v)) < 1e-9;
/** One out-of-range field of a MIXED box: integer → permille (÷1000); non-integer ≤ 10 → tenfold (÷10). */
export function rescaleOutOfRange(v) {
  if (!(v > 1)) return v;
  if (v <= TENFOLD_MAX && !isInteger(v)) return v / 10;
  return v / 1000;
}

export function normalizeBbox(raw) {
  if (!raw || typeof raw !== 'object') return null;
  let x = num(raw.x), y = num(raw.y), width = num(raw.width), height = num(raw.height);
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

  const out = {
    x: Math.min(Math.max(x, 0), 0.95),
    y: Math.min(Math.max(y, 0), 0.95),
    width: Math.min(Math.max(width, 0), 1),
    height: Math.min(Math.max(height, 0), 1),
  };
  if (out.width < MIN_BBOX_EXTENT || out.height < MIN_BBOX_EXTENT) return null;
  return out;
}

/**
 * Detect a box the OLD normaliser damaged (some fields divided by 1000 that were already
 * fractions) and undo it. Used by the repair sweep; returns null when the box is fine.
 * Only fields below MIN_BBOX_EXTENT are candidates, and the inversion is accepted only if
 * it yields a sane fraction — a genuinely tiny box (< 0.5% of the page) stays as it is
 * when ×1000 would push it past the page edge.
 */
export function repairMixedUnitBbox(bbox) {
  if (!bbox || typeof bbox !== 'object') return null;
  const fields = ['x', 'y', 'width', 'height'];
  const tiny = fields.filter(f => num(bbox[f]) > 0 && num(bbox[f]) < MIN_BBOX_EXTENT / 5);
  // A damaged box always has a speck-sized width or height; a tiny x or y alone is just a
  // box flush against the page edge and must not be "repaired".
  if (tiny.length === 0 || tiny.length === 4) return null;
  if (!tiny.includes('width') && !tiny.includes('height')) return null;
  const fixed = { ...bbox };
  for (const f of tiny) fixed[f] = num(bbox[f]) * 1000;
  if (fixed.x + fixed.width > 1.02 || fixed.y + fixed.height > 1.02) return null;
  if (fixed.width < MIN_BBOX_EXTENT || fixed.height < MIN_BBOX_EXTENT) return null;
  return repairTenfoldResidual({ x: fixed.x, y: fixed.y, width: fixed.width, height: fixed.height }) || { x: fixed.x, y: fixed.y, width: fixed.width, height: fixed.height };
}

/**
 * The band the speck inversion cannot see (#4780 day 4, 2026-09-17). When the model wrote ONE
 * coordinate on a tenfold scale (`y: 1.33` for 0.133), the old whole-box ÷1000 stored 0.00133 —
 * above the speck threshold (MIN_BBOX_EXTENT / 5 = 0.001), so `repairMixedUnitBbox` restored
 * the three specks beside it and, by its own rule, left the lone small y as a box flush against
 * the page edge. The tell is arithmetic: a permille coordinate is an integer, so a stored value in
 * (0.001, 0.01] whose ×1000 is NOT an integer came from a tenfold raw, and its true value is ×100.
 * Applied only when the ×100 box stays inside the page; a real edge-flush box (`y: 0.006`, an
 * integer permille) is never touched. Returns the corrected box, or null when nothing applies.
 *
 * WHERE THE TELL IS DECISIVE AND WHERE IT IS ONLY A SCREEN. Inside `repairMixedUnitBbox` the
 * box provably went through the whole-box ÷1000 (it carries specks), so a non-integer permille
 * beside them can only be a tenfold raw — decisive. On a box WITHOUT specks (already repaired,
 * or from another writer) a stored 0.0087 may be a genuine 4-decimal fraction: the dry run of
 * 2026-09-17 listed a left-margin border at x = 0.0087 (width 0.03) and a pixel-derived
 * x = 0.00208206… — both real. There the function is a screen for a contact-sheet check, and
 * the sweep applies it only under an explicit flag.
 */
export const TENFOLD_RESIDUAL_MAX = TENFOLD_MAX / 1000; // 0.01
export function repairTenfoldResidual(bbox) {
  if (!bbox || typeof bbox !== 'object') return null;
  const fixed = { ...bbox }; let touched = 0;
  for (const f of ['x', 'y', 'width', 'height']) {
    const v = num(bbox[f]);
    if (v > 0.001 && v <= TENFOLD_RESIDUAL_MAX && !isInteger(v * 1000)) { fixed[f] = v * 100; touched++; }
  }
  if (!touched) return null;
  if (fixed.x + fixed.width > 1.02 || fixed.y + fixed.height > 1.02) return null;
  if (fixed.width < MIN_BBOX_EXTENT || fixed.height < MIN_BBOX_EXTENT) return null;
  return { x: fixed.x, y: fixed.y, width: fixed.width, height: fixed.height };
}

/**
 * Per-illustration rotation the vision model reports: the clockwise turn (degrees) needed to
 * make the illustration upright as printed. Plates bound sideways (Talhoffer's fight book:
 * every plate a fencer lying on his side) reached the gallery unrotated because no writer
 * ever produced this field — gallery-doc.mjs carried `rotation` and the thumbnail route
 * honoured it, but the extraction schema never asked (#4780 spot check, 2026-09-15: one
 * row corpus-wide). Returns 0 | 90 | 180 | 270; undefined for absent or non-quarter values.
 */
export function normalizeRotation(raw) {
  const n = typeof raw === 'string' ? (raw.trim() === '' ? NaN : Number(raw)) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
  const q = Math.round(n / 90) * 90;
  if (Math.abs(n - q) > 5) return undefined;
  return ((q % 360) + 360) % 360;
}
