// PRIOR ART: scripts/maintenance/repair-bulk-jp2-offset.mjs --source erara_pdf — re-archives a shifted e-rara book from
//   its IIIF canvases, but REFUSES a book with no page read before the archive ("cannot establish which side is
//   correct"), which is every unread book: 10,301 of the 12,908 shifted ones (v3#466, 2026-11-17).
// scripts/maintenance/shift-repairs-5803-driver.mjs — sequences the image and text repairs for the 151 books the Clef
//   screen found; its text map is a paid model call per page and it skips held books. The unread books are all held.
// scripts/lib/image-set-gate.mjs — says WHETHER a set is shifted; it decides nothing about what a repair may touch.
/**
 * What may be re-cut without a second thought: the UNREAD e-rara book (v3#466).
 *
 * A book whose stored images were cut from e-rara's PDF holds e-rara's cover sheet as image 1 and every leaf one row
 * late. Where nothing has been read, nothing can be stranded: the page rows were made from the IIIF manifest, each
 * row's `photo` is its own canvas, and the only thing wrong is the stored image. Re-archiving every row from its own
 * canvas is then safe by construction, PROVIDED the book really carries nothing that was read or measured from the
 * old images. That proviso is this file: a page may carry only the keys listed here. Any other key (text, a page
 * frame, a detected picture, a printed page number, a field added next month) means something was derived from the
 * leaf that sat on that row, and the book is left for the repair that moves such things with their leaf.
 *
 * Pure: no I/O.
 */

/** Keys an unread page may carry. Identity, the source pointers, the stored-image pointers and their sizes, counters. */
export const UNREAD_PAGE_KEYS = Object.freeze(new Set([
  '_id', 'id', 'book_id', 'page_number', 'created_at', 'updated_at', 'tenantId',
  'photo', 'photo_original', 'thumbnail',
  'archived_photo', 'display_photo', 'thumbnail_blob', 'image_thumb', 'archive_metadata', 'image_width', 'image_height',
  'read_count',
]));

export const ERARA_CANVAS_RE = /e-rara\.ch\/i3f\/v21\/\d+\/full\//;

/** Book fields built from the page images, cleared after a re-cut so they are made again from the right leaves. */
export const BOOK_IMAGE_DERIVED_UNSET = Object.freeze(['thumbnail_frame', 'hero_mosaic_url', 'hero_mosaic_version', 'hero_mosaic_at', 'hero_mosaic_built_from', 'rearchive_blocked']);

/**
 * Why this book is not a plain unread re-cut (a sentence), or null when it is.
 * @param {object} o
 * @param {object} o.book    id, pages_ocr, pages_translated, archive_metadata, summary, chapters, index
 * @param {object[]} o.pages every page of the book, with every top-level key present (large text bodies may be projected
 *                           away as long as the `ocr` / `translation` keys themselves survive)
 * @param {object[]} [o.events] the book's book_events rows of type text_shift_repair / text_shift_repair_undo
 */
export function unreadRecutRefusal({ book, pages, events = [] }) {
  if (!book) return 'book not found';
  if (book.archive_metadata?.jp2_offset_repaired === true) return 'already repaired (archive_metadata.jp2_offset_repaired)';
  if (!pages?.length) return 'no pages';
  const nums = pages.map((p) => p.page_number).sort((a, b) => a - b);
  if (nums[0] !== 1 || nums.some((n, i) => n !== i + 1)) return `page numbers are not 1..${pages.length} without gaps (a hidden, split or repeated page)`;
  if ((book.pages_ocr || 0) > 0 || (book.pages_translated || 0) > 0) return `the book counts ${book.pages_ocr || 0} transcribed and ${book.pages_translated || 0} translated pages`;
  for (const f of ['summary', 'chapters', 'index', 'reading_summary']) {
    const v = book[f];
    if (v != null && !(Array.isArray(v) && v.length === 0) && v !== '') return `the book carries ${f}, which was made from page text`;
  }
  if (events.length) return `the book has ${events.length} text-move event(s) on record`;
  for (const p of pages) {
    const extra = Object.keys(p).filter((k) => !UNREAD_PAGE_KEYS.has(k));
    if (extra.length) return `page ${p.page_number} carries ${extra.slice(0, 5).join(', ')}: something was read or measured from the leaf on that row`;
    if (p.archive_metadata?.source !== 'erara_pdf') return `page ${p.page_number} was not archived from the e-rara PDF (${p.archive_metadata?.source ?? 'no archive record'})`;
    if (Number.isInteger(p.archive_metadata?.pdf_leaf_offset)) return `page ${p.page_number} carries the archiver's corrected mapping (pdf_leaf_offset)`;
    if (!ERARA_CANVAS_RE.test(String(p.photo_original || p.photo))) return `page ${p.page_number} has no e-rara IIIF canvas to re-cut from`;
  }
  return null;
}

/**
 * The cover after a re-cut. A cover that is one of the book's own stored page images shows, after the re-cut, the NEXT
 * leaf (the key is the same, the picture behind it moved). The leaf that was chosen now sits one row earlier.
 * @returns {{ from: number, to: number, page: object } | null}  null: the cover is not one of this book's page images
 */
export function coverAfterRecut(book, pages) {
  const url = book?.thumbnail;
  if (typeof url !== 'string' || !url) return null;
  const bare = (u) => String(u || '').split('?')[0];
  const row = pages.find((p) => [p.archived_photo, p.display_photo, p.thumbnail_blob, p.image_thumb].some((u) => u && bare(u) === bare(url)));
  if (!row) return null;
  // Row 1 held e-rara's cover sheet, which has no leaf: a book whose cover was the sheet gets leaf 1.
  const to = Math.max(1, row.page_number - 1);
  return { from: row.page_number, to, page: pages.find((p) => p.page_number === to) };
}
