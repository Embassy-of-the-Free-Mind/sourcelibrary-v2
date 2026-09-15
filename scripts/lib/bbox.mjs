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
export function normalizeBbox(raw) {
  if (!raw || typeof raw !== 'object') return null;
  let x = num(raw.x), y = num(raw.y), width = num(raw.width), height = num(raw.height);
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
  return { x: fixed.x, y: fixed.y, width: fixed.width, height: fixed.height };
}
