/**
 * Which rasterized PDF page is which leaf of an e-rara book (#5803, #3186).
 *
 * PRIOR ART: scripts/lib/page-alignment.mjs — checkAlignment() detects a shift AFTER the
 * images are in R2 (dHash against the IIIF canvas); it cannot tell the archiver which PDF
 * page to store. scripts/maintenance/repair-bulk-jp2-offset.mjs --source erara_pdf repairs
 * the shift this file stops being written. Neither is a mapping the writer can call.
 *
 * e-rara's generated PDF starts with a cover sheet ("www.e-rara.ch … Persistent Link")
 * that is not in the IIIF manifest our `pages` rows were made from. The archiver stored
 * PDF page N as page N, so every image sat one leaf behind its page (page 1 = the cover
 * sheet, the last leaf never archived). Text read from IIIF before archival then
 * disagreed with the image; text repaired to match IIIF was re-shifted when the book was
 * archived again (45 books, 2026-08-30 to 2026-10-01).
 *
 * The cover sheet is recognised by COUNT, not assumed: the PDF must have exactly one
 * page more than the book has leaves. Anything else is refused, because a guess here
 * returns a real, complete, 200-OK JPEG of the wrong leaf and nothing fails.
 */

/** PDF pages before leaf 1 when the PDF is the manifest plus e-rara's cover sheet. */
export const ERARA_PDF_COVER_SHEETS = 1;

/**
 * @param {object} o
 * @param {number} o.pdfPages    pages pdftoppm produced
 * @param {number} o.leafCount   `pages` rows of the book (page_number 1..leafCount)
 * @param {number} o.archivedOther  pages already archived WITHOUT this offset stamped on
 *                                  them (old mapping, or another archiver)
 * @returns {{ offset: number } | { refuse: string }}
 */
export function eraraPdfLeafOffset({ pdfPages, leafCount, archivedOther = 0 }) {
  if (!Number.isInteger(pdfPages) || !Number.isInteger(leafCount) || pdfPages < 1 || leafCount < 1) {
    return { refuse: `no count to compare (pdf ${pdfPages}, leaves ${leafCount})` };
  }
  if (pdfPages !== leafCount + ERARA_PDF_COVER_SHEETS) {
    return { refuse: `pdf has ${pdfPages} pages, book has ${leafCount} leaves; expected ${leafCount + ERARA_PDF_COVER_SHEETS} (cover sheet + leaves)` };
  }
  // Filling the gaps of a book archived under another mapping puts two mappings in one
  // book: a seam where one leaf shows twice and its neighbour is on no page.
  if (archivedOther > 0) {
    return { refuse: `${archivedOther} pages already archived under another mapping; filling the gaps would leave a seam` };
  }
  return { offset: ERARA_PDF_COVER_SHEETS };
}

/** The index into the sorted pdftoppm output that holds `pageNumber`'s leaf. */
export function pdfIndexForPage(pageNumber, offset) {
  return pageNumber - 1 + offset;
}
