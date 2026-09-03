/**
 * Canonical page-count convention (issue #3293) — TS twin of
 * scripts/lib/page-counts.mjs. Keep the two in lock-step.
 *
 * `books.pages_count` / `pages_ocr` / `pages_translated` are VISIBLE-only:
 * they count pages with `page_number > 0`. Pages with `page_number <= 0` are
 * a deliberate soft-hide — they never render in the reader — so counting them
 * corrupts the read path (which divides by `pages_count` for readability
 * gates). Every writer that recomputes these counters must count visible
 * pages only.
 */

import type { Document } from 'mongodb';

/** Match fragment selecting only visible (renderable) pages. */
export const VISIBLE_PAGE_MATCH = { page_number: { $gt: 0 } } as const;

/** Page types that will never carry a translation. Mirror of the .mjs list. */
export const NEVER_TRANSLATED_PAGE_TYPES = ['blank', 'exlibris', 'bookplate', 'digitizer-notice'];

/** Shared by the `translatable` denominator and its numerator, so they cannot drift. */
const TRANSLATABLE_COND = {
  $and: [
    // No `ocr.data` requirement: a page awaiting OCR is PENDING work, not impossible
    // work, and excluding it badges half-OCR'd books as 100% translated. Mirror of the
    // .mjs rule — keep the two in step.
    { $not: [{ $in: [{ $ifNull: ['$page_type', ''] }, NEVER_TRANSLATED_PAGE_TYPES] }] },
    { $ne: ['$translation.recitation_blocked', true] },
    { $ne: ['$translation.safety_blocked', true] },
    { $ne: ['$ocr.recitation_blocked', true] },
  ],
};

/**
 * Aggregation pipeline returning
 * { total, with_ocr, with_translation, translatable, translated_translatable, blank }
 * for the VISIBLE pages of one book. Mirror of the .mjs implementation.
 */
export function buildVisiblePageCountPipeline(bookId: string): Document[] {
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
                // Attempted-but-not-legible pages retain `data` for provenance
                // but are not served (#4523) — they must not count as OCR'd.
                { $ne: ['$ocr.unreadable', true] },
              ] },
              1, 0,
            ],
          },
        },
        // Blank leaves carry the placeholder "[Blank page — no translatable
        // content]", not a translation, and are already excluded from the
        // denominator via `pages_blank` — counting them here is what pushed
        // `translation_pct` over 100 on 6,228 live books. Mirror of the .mjs
        // isTranslatedPage() rule; keep the two in step.
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
        // The honest denominator for translation completeness (#4442) and its
        // matching numerator. Any writer that updates the three counters above
        // must write `pages_translatable` too, or it goes stale while they move.
        translatable: {
          $sum: { $cond: [TRANSLATABLE_COND, 1, 0] },
        },
        // Pages that legitimately carry no translation — the `pages_blank` counter.
        // Named for the historical field; the set is every never-translated type that
        // nonetheless has OCR, which is what the translation job has always recorded.
        blank: {
          $sum: {
            $cond: [
              { $and: [
                { $in: [{ $ifNull: ['$page_type', ''] }, NEVER_TRANSLATED_PAGE_TYPES] },
                { $ne: ['$ocr.data', null] },
                { $ne: ['$ocr.data', ''] },
                { $ifNull: ['$ocr.data', false] },
              ] },
              1, 0,
            ],
          },
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
