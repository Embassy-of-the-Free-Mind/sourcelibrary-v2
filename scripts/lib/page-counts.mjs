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
        with_translation: {
          $sum: {
            $cond: [
              { $and: [
                { $ne: ['$translation.data', null] },
                { $ne: ['$translation.data', ''] },
                { $ifNull: ['$translation.data', false] },
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
    with_translation: visible.filter(hasTranslation).length,
  };
}
