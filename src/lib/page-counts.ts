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

/**
 * Aggregation pipeline returning { total, with_ocr, with_translation } for
 * the VISIBLE pages of one book. Mirror of the .mjs implementation.
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
      },
    },
  ];
}
