/**
 * Is this frame ONE image across the fold — a plate, a map, a fold-out — rather than two leaves? (#8042)
 *
 * PRIOR ART: scripts/split-book.mjs Step 2.5 (`imgFrac`) classifies a whole BOOK from its OCR page types and keeps a
 * plate book whole, but never looks at a single frame, so a plate bound into a text book is cut at the gutter like
 * the text around it (the Khunrath Emerald Table, BPH 69ef33e2, frame -127, run spwmc8). fix-false-split-portrait-
 * pages.mjs tests a SINGLE-LEAF frame by aspect ratio; a plate spanning a fold is as wide as a real spread, so aspect
 * cannot see it. scripts/audit/spread-confirm.mjs asks a model per book, not per frame. This reads what the frame's own
 * stored read already says, for free.
 *
 * The rule, in order (first hit wins):
 *   1. The frame's read has a <page-break/>: it holds two leaves of text → split (text spreads must still split).
 *   2. The read is plate-typed (page-type illustration/map/plate/frontispiece/diagram) AND the spread prompt said the
 *      frame is a single page (<split-position>null</split-position>) → keep whole. A read with NO split-position tag
 *      came from a single-page prompt and cannot tell a plate from a frontispiece facing a title page, so it does not
 *      decide; only rule 3 can keep that frame whole.
 *   3. The read is plate-typed or there is no read, AND a detected image's bbox crosses the cut with at least MIN_SPAN
 *      of the frame width on EACH side → keep whole. A text or title-page read does not qualify: one detection box
 *      drawn round a title page AND the text page facing it crossed the gutter of a real two-leaf spread (BPH
 *      68679f27, frame -3, seen by eye 2026-11-04).
 *   4. Otherwise → split.
 *
 * What it cannot see: a frame with no stored read and no detections (it falls to rule 4 — split, the old behaviour),
 * and a plate whose read wrongly says text. Rule 3 needs `detected_images` measured on the FRAME, not on a leaf.
 */

export const PLATE_PAGE_TYPES = new Set(['illustration', 'map', 'plate', 'frontispiece', 'diagram']);
/** Fraction of the frame width an image must reach past the cut on each side to count as crossing it. */
export const MIN_SPAN = 0.05;

function readPageType(ocrText, pageType) {
  const m = String(ocrText || '').match(/<page-type>\s*([^<]*?)\s*<\/page-type>/i);
  return String((m && m[1]) || pageType || '').toLowerCase().trim();
}

/**
 * @param {object} frame
 * @param {string} [frame.ocrText]   the frame's stored read (ocr.data)
 * @param {string} [frame.pageType]  the stored page_type, used when the read carries no <page-type>
 * @param {Array<{bbox?:{x:number,width:number}}>} [frame.detectedImages] detections on the FRAME, bbox 0–1 of its width
 * @param {number} cut               the proposed cut, 0–1000 of the frame width
 * @returns {{ keepWhole: boolean, reason: string }}
 */
export function plateSpanVerdict({ ocrText = '', pageType = '', detectedImages = [] } = {}, cut) {
  const text = String(ocrText || '');
  if (/<page-break\s*\/?>/i.test(text)) return { keepWhole: false, reason: 'page-break: two leaves of text' };

  const type = readPageType(text, pageType);
  const pos = text.match(/<split-position>\s*([^<]*?)\s*<\/split-position>/i);
  const saysSingle = !!pos && /^(null|none|)$/i.test(pos[1]);
  if (PLATE_PAGE_TYPES.has(type) && saysSingle) {
    return { keepWhole: true, reason: `read says ${type}, split-position ${pos[1] || 'empty'}` };
  }

  if (Number.isFinite(cut) && (PLATE_PAGE_TYPES.has(type) || !type)) {
    const c = cut / 1000;
    for (const d of Array.isArray(detectedImages) ? detectedImages : []) {
      const b = d && d.bbox;
      if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.width)) continue;
      if (c - b.x >= MIN_SPAN && b.x + b.width - c >= MIN_SPAN) {
        return { keepWhole: true, reason: `image ${b.x.toFixed(2)}–${(b.x + b.width).toFixed(2)} crosses the cut at ${c.toFixed(2)}` };
      }
    }
  }
  return { keepWhole: false, reason: 'no plate signal' };
}

/**
 * Map a detection bbox (0–1 of one half) onto the joined image of two halves placed side by side.
 * @param {{x:number,y:number,width:number,height:number}} bbox
 * @param {'left'|'right'} side
 * @param {number} wLeft   pixel width of the left half in the joined image
 * @param {number} wRight  pixel width of the right half in the joined image
 */
export function bboxToJoined(bbox, side, wLeft, wRight) {
  const W = wLeft + wRight;
  const off = side === 'right' ? wLeft : 0;
  const w = side === 'right' ? wRight : wLeft;
  return { ...bbox, x: (off + bbox.x * w) / W, width: (bbox.width * w) / W };
}

/** Smallest bbox holding both. */
export function bboxUnion(a, b) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}
