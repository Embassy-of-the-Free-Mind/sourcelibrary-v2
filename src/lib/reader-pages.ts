/**
 * Which pages a reader pages through (#5056).
 *
 * PRIOR ART: src/lib/page-counts.ts VISIBLE_PAGE_MATCH — the counters' rule
 * (`page_number > 0`); the reader's list is deliberately wider (it keeps page 0
 * and drops two page types), so it cannot simply spread it. This module is the
 * one copy of the reader's rule, which five routes had each inlined as the same
 * `p.page_type !== 'digitizer-insert' && p.page_type !== 'archived-spread'`.
 *
 * A page is left out of the reader's list when:
 *  - its `page_number` is negative (a soft-hidden duplicate or split parent),
 *  - its `page_type` is in HIDDEN_PAGE_TYPES or is `archived-spread`, or
 *  - it carries `repeat_of`: a later capture of a leaf the book already holds
 *    (the same spread uploaded or photographed twice). `repeat_of` is the `id`
 *    of the kept capture. The page keeps its number and id, so a shortlink or
 *    citation made against it still resolves (the reader redirects it to the
 *    kept page); unsetting the field restores it.
 *
 * Direct URLs still resolve: this filters LISTS, never lookups by id.
 */

import { HIDDEN_PAGE_TYPES } from '@/lib/types/prompts/defaults';
import { NOT_REPEAT_CAPTURE, isRepeatCapture } from '@/lib/page-counts';

export { NOT_REPEAT_CAPTURE, isRepeatCapture };

/** Page types the reader's list leaves out (still reachable by direct URL). */
export const READER_HIDDEN_PAGE_TYPES: ReadonlySet<string> = new Set([...HIDDEN_PAGE_TYPES, 'archived-spread']);

/** Mongo filter for one book's reader list. Pair with `isReaderListedPage` (the page types). */
export function readerPageListFilter(bookId: string) {
  return { book_id: bookId, page_number: { $gte: 0 }, ...NOT_REPEAT_CAPTURE };
}

/**
 * True iff the page belongs in the reader's page list. The projection that
 * loaded it must include `page_type`, `page_number` and `repeat_of`.
 */
export function isReaderListedPage(page: object | null | undefined): boolean {
  if (!page) return false;
  const p = page as { page_type?: unknown; page_number?: unknown; repeat_of?: unknown };
  if (typeof p.page_type === 'string' && READER_HIDDEN_PAGE_TYPES.has(p.page_type)) return false;
  if (typeof p.page_number === 'number' && p.page_number < 0) return false;
  return !isRepeatCapture(p);
}
