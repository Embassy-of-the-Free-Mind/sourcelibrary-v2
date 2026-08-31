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
 * Page types that will never carry a translation, whatever we spend.
 *
 * Kept as a literal rather than imported from `translate-core.mjs` because that
 * module imports THIS one; the two must stay in step and
 * `tests/unit/page-counts.test.ts` is where that is asserted.
 */
export const NEVER_TRANSLATED_PAGE_TYPES = ['blank', 'exlibris', 'bookplate', 'digitizer-notice'];

/**
 * True iff a page is work the translator could actually do — the honest
 * DENOMINATOR for translation completeness (#4442).
 *
 * `pages_count` is the wrong denominator and always has been: it counts every
 * visible page, including ones no amount of money will ever translate.
 *
 * Measured 2026-08-31 on an unrestricted random sample of 800 live books:
 * **11.4%** are complete by the naive measure (`pages_translated >= pages_count`,
 * which matches the exact corpus figure of 10.2%), while **49.9%** have every
 * translatable page translated. Roughly half the library is finished and says it
 * is not.
 *
 * Do not repeat the earlier "~41%" figure. It came from extrapolating a sample
 * restricted to books with a 1-25 page apparent tail, which structurally cannot
 * see a complete book carrying a hundred pages of plates — and so undercounted.
 * A sample frame chosen for one question is rarely valid for the next one.
 *
 * A page qualifies only if it has OCR to translate from, is not a never-translated
 * type, and has not been permanently refused by the model.
 */
export function isTranslatablePageForCount(page) {
  if (!isVisiblePage(page)) return false;
  if (!hasOcr(page)) return false;
  if (NEVER_TRANSLATED_PAGE_TYPES.includes(page?.page_type ?? '')) return false;
  if (page?.translation?.recitation_blocked === true) return false;
  if (page?.translation?.safety_blocked === true) return false;
  if (page?.ocr?.recitation_blocked === true) return false;
  return true;
}

/** Mongo twin of isTranslatablePageForCount(), shared by the denominator and its numerator. */
const TRANSLATABLE_COND = {
  $and: [
    { $ne: ['$ocr.data', null] },
    { $ne: ['$ocr.data', ''] },
    { $ifNull: ['$ocr.data', false] },
    { $not: [{ $in: [{ $ifNull: ['$page_type', ''] }, NEVER_TRANSLATED_PAGE_TYPES] }] },
    { $ne: ['$translation.recitation_blocked', true] },
    { $ne: ['$translation.safety_blocked', true] },
    { $ne: ['$ocr.recitation_blocked', true] },
  ],
};

/**
 * Aggregation pipeline that returns
 * { total, with_ocr, with_translation, translatable, translated_translatable }
 * for the VISIBLE pages of one book. Used by the batch collectors and the recount.
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
        // The honest denominator and ITS matching numerator (#4442). Mirrors
        // isTranslatablePageForCount(). `translatable` is what could ever be
        // translated; `translated_translatable` is how much of that has been —
        // and it is deliberately NOT `with_translation`, because a numerator
        // must exclude whatever its denominator excludes. Getting that wrong is
        // what produced the Blue Qur'an's 1000% above, and a 105.6% reading on
        // Hugh of Santalla while this was being written.
        translatable: {
          $sum: { $cond: [TRANSLATABLE_COND, 1, 0] },
        },
        translated_translatable: {
          $sum: {
            $cond: [
              { $and: [
                TRANSLATABLE_COND,
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
  const translatable = visible.filter(isTranslatablePageForCount);
  return {
    total: visible.length,
    with_ocr: visible.filter(hasOcr).length,
    with_translation: visible.filter(isTranslatedPage).length,
    translatable: translatable.length,
    translated_translatable: translatable.filter(hasTranslation).length,
  };
}
