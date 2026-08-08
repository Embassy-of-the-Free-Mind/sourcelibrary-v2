/**
 * Canonical page-count convention (issue #3293).
 *
 * `books.pages_count` / `pages_ocr` / `pages_translated` are VISIBLE-only:
 * they count pages with `page_number > 0`. Pages with `page_number <= 0`
 * are a deliberate soft-hide — they never render in the reader — so counting
 * them corrupts the read path, which prints `pages_count` as "N scans" and
 * divides by it for `hasTranslations`, the ≥90%-readable filter, and the
 * `TranslatedSiblingNotice` <5% gate.
 *
 * Every writer that recomputes these counters (batch collectors, the split
 * worker, realtime translate) must count visible pages only. This module is
 * the single source of that rule so the convention can't drift per-writer
 * again. Pinned by tests/unit/page-counts.test.ts.
 */

/** Match fragment selecting only visible (renderable) pages. */
export const VISIBLE_PAGE_MATCH = { page_number: { $gt: 0 } };

/** True iff a page renders in the reader (soft-hidden pages have page_number <= 0). */
export function isVisiblePage(page) {
  return (page?.page_number ?? 0) > 0;
}

/** True iff a page carries non-empty OCR text. */
export function hasOcr(page) {
  const data = page?.ocr?.data;
  return typeof data === 'string' && data !== '';
}

/** True iff a page carries non-empty translation text. */
export function hasTranslation(page) {
  const data = page?.translation?.data;
  return typeof data === 'string' && data !== '';
}

/** True iff the page is a blank leaf (flyleaf, endpaper, empty verso). */
export function isBlankPage(page) {
  return (page?.page_type ?? '') === 'blank';
}

/**
 * True iff a page counts toward `pages_translated`.
 *
 * A blank leaf does NOT, even though it carries translation text: the
 * translator writes the literal placeholder "[Blank page — no translatable
 * content]" onto every blank page. Measured 2026-08-08, that was 87,777 pages
 * — flyleaves and endpapers — counted as translations, 99.8% of them under 120
 * characters.
 *
 * It also made `translation_pct` exceed 100 on 6,228 live books (32% of the
 * public library), because blank pages are subtracted from the denominator
 * (`pages_ocr - pages_blank`) while still being counted in the numerator. The
 * Blue Qur'an reported **1000% translated**: 60 pages, 54 of them blank, over a
 * denominator of 6.
 */
export function isTranslatedPage(page) {
  return hasTranslation(page) && !isBlankPage(page);
}

/**
 * Aggregation pipeline that returns { total, with_ocr, with_translation }
 * for the VISIBLE pages of one book. Used by the batch collectors.
 */
export function buildVisiblePageCountPipeline(bookId) {
  return [
    { $match: { book_id: bookId, ...VISIBLE_PAGE_MATCH } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        with_ocr: {
          $sum: {
            $cond: [
              { $and: [
                { $ne: ['$ocr.data', null] },
                { $ne: ['$ocr.data', ''] },
                { $ifNull: ['$ocr.data', false] },
              ] },
              1, 0,
            ],
          },
        },
        // Mirrors isTranslatedPage(): blank leaves carry a placeholder, not a
        // translation, and must not count here — they are already excluded
        // from the denominator via `pages_blank`.
        with_translation: {
          $sum: {
            $cond: [
              { $and: [
                { $ne: ['$translation.data', null] },
                { $ne: ['$translation.data', ''] },
                { $ifNull: ['$translation.data', false] },
                { $ne: [{ $ifNull: ['$page_type', ''] }, 'blank'] },
              ] },
              1, 0,
            ],
          },
        },
      },
    },
  ];
}

/**
 * Pure JS twin of the pipeline: count visible-page stats from an in-memory
 * page array. Same convention as buildVisiblePageCountPipeline; used where a
 * writer already holds the pages, and by the test that pins the rule.
 */
export function countVisiblePageStats(pages) {
  const visible = (pages ?? []).filter(isVisiblePage);
  return {
    total: visible.length,
    with_ocr: visible.filter(hasOcr).length,
    with_translation: visible.filter(isTranslatedPage).length,
  };
}
