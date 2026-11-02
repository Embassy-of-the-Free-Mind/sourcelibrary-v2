/**
 * Is a page's TEXT from the leaf its IMAGE shows? Read against the provider's own page
 * labels, an external numbering that a uniform shift cannot fake (#7949).
 *
 * PRIOR ART: scripts/lib/page-alignment.mjs checkAlignment() dHashes images at offsets 0
 *   and +1 only and never reads the text, so a TEXT-side shift whose images are right is
 *   invisible to it. scripts/lib/leaf-alignment.mjs (#7866) finds repeats, text on blank
 *   leaves and image shifts, and its own experiment note lists "text-side shifts on e-rara
 *   books whose images are their own leaves" as missed. scripts/maintenance/detect-
 *   translation-misalignment.mjs compares <page-num> in the OCR against the English, two
 *   layers of the same page, and cannot see both moving together. The paired-artifacts
 *   invariant warns that <page-num> SEQUENCE breaks miss a uniform shift; this compares
 *   <page-num> with a numbering produced by someone else, so a uniform shift shows as a
 *   uniform offset rather than as nothing.
 *
 * The shape (#7949, Huser's Paracelsus 1589, 69bd9d546120d54bd0375241): images archived
 * from e-rara's whole-book PDF (which carries leaves the IIIF manifest does not), batch OCR
 * read those images, then a resolution upgrade (2026-07-20, before the #3359 guard)
 * re-fetched every slot from the IIIF canvas at the same index. Images became right; the
 * text stayed three leaves late.
 *
 * Pure: no I/O. Callers supply the page docs and the manifest's canvas labels.
 */

/** Pages searched either side of a slot for a label equal to its printed number. */
export const LABEL_WINDOW = 8;

/** The printed page number OCR recorded, as an integer, or null when there is none or several. */
export function printedNumber(ocrData) {
  const m = String(ocrData ?? '').match(/<page-num>([^<]*)<\/page-num>/);
  if (!m) return null;
  const s = m[1].trim();
  return /^\d{1,4}$/.test(s) ? Number(s) : null;
}

/** A canvas label as an integer: "136", "[136]", "S. 136", "p. 136". Null otherwise. */
export function labelNumber(label) {
  const raw = typeof label === 'object' && label !== null ? (label['@value'] ?? label.none?.[0] ?? label.en?.[0]) : label;
  const s = String(raw ?? '').trim().replace(/^(?:s\.|p\.|pag\.|seite|page)\s*/i, '').replace(/^\[(.*)\]$/, '$1').trim();
  return /^\d{1,4}$/.test(s) ? Number(s) : null;
}

/**
 * Per slot: where does the text sitting here belong? offset k means the text on slot s
 * is the text of the leaf at slot s+k (k = −3: the text is three leaves late).
 * Null when the page has no usable printed number, or the label match is absent or
 * not unique within the window (printed numbering restarts per part in a multi-part book).
 *
 * @param {Array<{page_number:number, ocr?:{data?:string}}>} pages
 * @param {Array<number|null>} labels  labels[i] is the label of canvas i+1 (slot i+1)
 */
export function slotOffsets(pages, labels, { window = LABEL_WINDOW } = {}) {
  return pages.map((p) => {
    const pn = printedNumber(p.ocr?.data);
    if (pn == null) return { page: p.page_number, printed: null, offset: null };
    const hits = [];
    for (let k = -window; k <= window; k++) {
      const t = p.page_number + k;
      if (t >= 1 && t <= labels.length && labels[t - 1] === pn) hits.push(k);
    }
    return { page: p.page_number, printed: pn, offset: hits.length === 1 ? hits[0] : null };
  });
}

/** Offset histogram over the slots that scored. */
export function offsetHistogram(rows) {
  const h = {};
  for (const r of rows) if (r.offset != null) h[r.offset] = (h[r.offset] ?? 0) + 1;
  return h;
}

/**
 * Split the book into runs of one constant offset. A run is extended over unscored
 * slots between two scored slots of the SAME offset; a change of offset closes it.
 * Isolated disagreeing slots (a misprinted page number) are kept as their own runs so
 * the caller can see them rather than have them averaged away.
 *
 * @returns {Array<{from:number, to:number, offset:number, scored:number}>}
 */
export function offsetRuns(rows) {
  const runs = [];
  let cur = null;
  for (const r of rows) {
    if (r.offset == null) continue;
    if (cur && cur.offset === r.offset) { cur.to = r.page; cur.scored++; continue; }
    if (cur) runs.push(cur);
    cur = { from: r.page, to: r.page, offset: r.offset, scored: 1 };
  }
  if (cur) runs.push(cur);
  return runs;
}

/**
 * Book verdict. `aligned`: offset 0 dominates. `shifted`: one non-zero offset holds at
 * least `min` of the scored slots. `mixed`: anything else (read by eye before repair).
 * `unscored`: too few slots with both a printed number and a numeric label.
 */
export function bookVerdict(rows, { minScored = 20, min = 0.6 } = {}) {
  const h = offsetHistogram(rows);
  const scored = Object.values(h).reduce((a, b) => a + b, 0);
  if (scored < minScored) return { verdict: 'unscored', scored, histogram: h };
  const [topK, topN] = Object.entries(h).sort((a, b) => b[1] - a[1])[0];
  const share = topN / scored;
  const k = Number(topK);
  if (k === 0 && share >= min) return { verdict: 'aligned', scored, offset: 0, share, histogram: h };
  if (k !== 0 && share >= min) return { verdict: 'shifted', scored, offset: k, share, histogram: h };
  return { verdict: 'mixed', scored, offset: k, share, histogram: h };
}
