/**
 * The catalogue's filter contract — ONE module that both builds the query
 * string and reads it back.
 *
 * A filter is only real if the name the client puts on the wire is the name the
 * route reads (`.claude/docs/invariants/search-filters-and-lanes.md`: three
 * filters were inert in production because those two names disagreed, and each
 * looked fine in a browser — results appeared, the chip lit up, and nothing was
 * constrained). Here the builder and the parser are the same file and are
 * round-tripped in `tests/unit/search-filter-wire-names.test.ts`, so a rename
 * that reaches only one side cannot compile past the test.
 *
 * `/catalog` (the address bar), `/api/catalog/browse` and `/api/catalog/csv`
 * all speak these names.
 */

export const CATALOG_SORTS = [
  'relevance',
  'popular',
  'recent',
  'last_translated',
  'title',
  'author',
  'year_asc',
  'year_desc',
  'quality',
] as const;

export type CatalogSort = (typeof CATALOG_SORTS)[number];

/** Sorts the Supabase lane can serve. `relevance` only exists inside an ask. */
export const BROWSE_SORTS = CATALOG_SORTS.filter((s) => s !== 'relevance');

export type CatalogView = 'grid' | 'list';

export interface CatalogFilters {
  /** Literal title/author substring. */
  q: string;
  /** A question for the librarian — routed through the semantic lane. */
  ask: string;
  sort: CatalogSort;
  /** `books_catalog.language` — the EDITION's language (see language-fields.md). */
  language: string;
  collection: string;
  category: string;
  /** `image_source_provider` — the library that holds the scans. */
  provider: string;
  yearMin: number | null;
  yearMax: number | null;
  firstTranslation: boolean;
  hasTranslation: boolean;
  hasOcr: boolean;
  page: number;
  view: CatalogView;
}

export const DEFAULT_FILTERS: CatalogFilters = {
  q: '',
  ask: '',
  sort: 'popular',
  language: '',
  collection: '',
  category: '',
  provider: '',
  yearMin: null,
  yearMax: null,
  firstTranslation: false,
  hasTranslation: false,
  hasOcr: false,
  page: 1,
  view: 'grid',
};

/**
 * The widest range the filter will accept. Deliberately wider than where the
 * corpus's mass sits: `books_catalog.year` carries negative years for ancient
 * works (the earliest row is -2880), and a floor of 1000 would have made every
 * one of them unreachable by a typed range. The year-histogram window is a
 * separate, narrower thing — see `getCatalogFacets`.
 */
export const YEAR_FLOOR = -4000;
export const YEAR_CEILING = 2000;

function clampYear(n: number): number {
  return Math.min(YEAR_CEILING, Math.max(YEAR_FLOOR, Math.round(n)));
}

/**
 * The wire names, in one place. Everything at its default is OMITTED, so a
 * default-state catalogue keeps a clean `/catalog` URL and the API keeps its
 * cache key small.
 *
 * `view` is a client-side preference and never reaches the API — pass
 * `includeView` only when building the address bar.
 */
export function buildCatalogParams(
  f: Partial<CatalogFilters>,
  opts: { includeView?: boolean; includePage?: boolean } = {},
): URLSearchParams {
  const { includeView = false, includePage = true } = opts;
  const p = new URLSearchParams();

  if (f.q) p.set('q', f.q);
  if (f.ask) p.set('ask', f.ask);
  if (f.sort && f.sort !== DEFAULT_FILTERS.sort) p.set('sort', f.sort);
  if (f.language) p.set('language', f.language);
  if (f.collection) p.set('collection', f.collection);
  if (f.category) p.set('category', f.category);
  if (f.provider) p.set('provider', f.provider);
  if (f.yearMin != null) p.set('year_min', String(clampYear(f.yearMin)));
  if (f.yearMax != null) p.set('year_max', String(clampYear(f.yearMax)));
  if (f.firstTranslation) p.set('first_translation', '1');
  if (f.hasTranslation) p.set('has_translation', '1');
  if (f.hasOcr) p.set('has_ocr', '1');
  if (includePage && f.page && f.page > 1) p.set('page', String(f.page));
  if (includeView && f.view && f.view !== DEFAULT_FILTERS.view) p.set('view', f.view);

  return p;
}

function readYear(raw: string | null): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? clampYear(n) : null;
}

/** Reads what `buildCatalogParams` wrote. Unknown values fall back to defaults. */
export function parseCatalogParams(sp: URLSearchParams): CatalogFilters {
  const sortRaw = sp.get('sort') || '';
  const viewRaw = sp.get('view') || '';
  const page = parseInt(sp.get('page') || '1', 10);

  let yearMin = readYear(sp.get('year_min'));
  let yearMax = readYear(sp.get('year_max'));
  // A reversed range returns nothing and reads as "we hold none of those",
  // which is a lie about the corpus. Swap it instead.
  if (yearMin != null && yearMax != null && yearMin > yearMax) {
    [yearMin, yearMax] = [yearMax, yearMin];
  }

  return {
    q: sp.get('q') || '',
    ask: sp.get('ask') || '',
    sort: (CATALOG_SORTS as readonly string[]).includes(sortRaw) ? (sortRaw as CatalogSort) : DEFAULT_FILTERS.sort,
    language: sp.get('language') || '',
    collection: sp.get('collection') || '',
    category: sp.get('category') || '',
    provider: sp.get('provider') || '',
    yearMin,
    yearMax,
    firstTranslation: sp.get('first_translation') === '1',
    hasTranslation: sp.get('has_translation') === '1',
    hasOcr: sp.get('has_ocr') === '1',
    page: Number.isFinite(page) && page > 0 ? page : 1,
    view: viewRaw === 'list' ? 'list' : 'grid',
  };
}

/** The filters that narrow the corpus — `sort`, `page` and `view` don't. */
export const NARROWING_KEYS = [
  'q',
  'ask',
  'language',
  'collection',
  'category',
  'provider',
  'yearMin',
  'yearMax',
  'firstTranslation',
  'hasTranslation',
  'hasOcr',
] as const satisfies readonly (keyof CatalogFilters)[];

export function countActiveFilters(f: CatalogFilters): number {
  let n = 0;
  for (const key of NARROWING_KEYS) {
    const value = f[key];
    const dflt = DEFAULT_FILTERS[key];
    if (key === 'yearMax' && f.yearMin != null) continue; // a range counts once
    if (value !== dflt) n++;
  }
  return n;
}

export function hasActiveFilters(f: CatalogFilters): boolean {
  return countActiveFilters(f) > 0;
}

/** Clears every narrowing filter and returns to page 1, keeping sort + view. */
export function clearFilters(f: CatalogFilters): CatalogFilters {
  return { ...DEFAULT_FILTERS, sort: f.sort, view: f.view };
}
