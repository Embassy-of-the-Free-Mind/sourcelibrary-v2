/**
 * Gallery "Load more" visibility.
 *
 * Extracted from GalleryClient so the rule is testable without a DOM. #3605:
 * `/gallery?type=artwork` (a filter value no facet matches, reachable from a
 * shared or hand-typed link) rendered "No images found", leftover items from
 * the previous unfiltered query, and a live "Load more" button all at once —
 * the button read `hasMore` from a response the visible results no longer came
 * from, and clicking it appended nothing.
 *
 * The item count is part of the decision, not a detail: with nothing on
 * screen there is nothing to load *more* of, whatever the last response said.
 */

export interface GalleryPaginationState {
  /** The server's own flag. Authoritative when present. */
  hasMore?: boolean | null;
  /** Total matches for the current filter set. */
  total?: number | null;
}

export function canLoadMore(
  state: GalleryPaginationState | null | undefined,
  itemCount: number,
  currentOffset: number,
): boolean {
  if (!state) return false;
  // Never offer to extend an empty result set.
  if (itemCount <= 0) return false;
  // Prefer the server's reliable flag; fall back to total-vs-offset.
  if (typeof state.hasMore === 'boolean') return state.hasMore;
  return currentOffset < (state.total ?? 0);
}
