/**
 * Which filter controls each /search lane actually honours.
 *
 * PRIOR ART: tests/unit/search-filter-wire-names.test.ts — pins the NAME a
 * filter travels under, but not whether a lane takes the filter at all; and
 * .claude/docs/invariants/search-filters-and-lanes.md, which states the rule
 * this table makes checkable.
 *
 * /search renders one filter panel over six lanes, and each lane reads a
 * different subset of it. A control the current lane ignores still changes the
 * URL and lights the "active filter" dot while the results stay exactly as they
 * were — which a reader experiences as a control that does not respond (#3401,
 * the top rageclick surface). Measured against production on 2026-10-13:
 * `collection` changed nothing in the All or Books lane, `has_doi` nothing in
 * the All lane, the year range nothing in browse, and no book filter reached
 * the index or gallery lanes.
 *
 * So the page shows a control only where the lane takes it. When a route learns
 * a new filter, add it here in the same PR —
 * `tests/unit/search-filter-support.test.ts` fails if this table claims a
 * filter the route does not read.
 */

export type SearchLane =
  | 'browse-books'   // /api/books/browse
  | 'browse-images'  // /api/gallery, no query
  | 'unified'        // /api/search/unified (the "All" tab)
  | 'books'          // /api/search
  | 'index'          // /api/search/index
  | 'images';        // /api/gallery?q=

export type SearchFilterKey =
  | 'language'
  | 'category'
  | 'collection'
  | 'library'
  | 'dates'
  | 'hasTranslation'
  | 'firstTranslation'
  | 'hasDoi';

/** The route file behind each lane, relative to the repo root. */
export const LANE_ROUTE: Record<SearchLane, string> = {
  'browse-books': 'src/app/api/books/browse/route.ts',
  'browse-images': 'src/app/api/gallery/route.ts',
  unified: 'src/app/api/search/unified/route.ts',
  books: 'src/app/api/search/route.ts',
  index: 'src/app/api/search/index/route.ts',
  images: 'src/app/api/gallery/route.ts',
};

/** Query-string names each filter travels under, per lane. */
export const LANE_FILTER_PARAMS: Record<SearchLane, Partial<Record<SearchFilterKey, string[]>>> = {
  'browse-books': {
    language: ['language'],
    category: ['category'],
    collection: ['collection'],
    library: ['library'],
    hasTranslation: ['has_translation'],
    firstTranslation: ['first_translation'],
  },
  'browse-images': {
    dates: ['yearStart', 'yearEnd'],
  },
  unified: {
    language: ['language'],
    category: ['category'],
    library: ['library'],
    dates: ['date_from', 'date_to'],
    hasTranslation: ['has_translation'],
    firstTranslation: ['first_translation'],
  },
  books: {
    language: ['language'],
    category: ['category'],
    library: ['library'],
    dates: ['date_from', 'date_to'],
    hasTranslation: ['has_translation'],
    firstTranslation: ['first_translation'],
    hasDoi: ['has_doi'],
  },
  index: {
    dates: ['date_from', 'date_to'],
  },
  images: {
    dates: ['yearStart', 'yearEnd'],
  },
};

/** Which sort dropdown, if any, the lane obeys. */
export const LANE_SORT: Record<SearchLane, 'search' | 'browse' | null> = {
  'browse-books': 'browse',
  'browse-images': null,
  unified: null,
  books: 'search',
  index: null,
  images: null,
};

export function searchLane(isBrowseMode: boolean, viewMode: 'unified' | 'books' | 'index' | 'images'): SearchLane {
  if (isBrowseMode) return viewMode === 'images' ? 'browse-images' : 'browse-books';
  return viewMode;
}

export function laneHonours(lane: SearchLane, filter: SearchFilterKey): boolean {
  return filter in LANE_FILTER_PARAMS[lane];
}

/**
 * A year typed into a filter box, or undefined while it is still being typed.
 * The box fires on every keystroke, and "17" on the way to "1700" is not a
 * request for books printed before the year 17.
 */
export function completeYear(value: string): number | undefined {
  const trimmed = value.trim();
  return /^\d{3,4}$/.test(trimmed) ? parseInt(trimmed, 10) : undefined;
}
