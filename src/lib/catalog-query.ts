/**
 * The library's filter contract — ONE module that both builds the query string
 * and reads it back.
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
 *
 * **Multi-value facets repeat their parameter** — `?language=Latin&language=Greek`
 * — rather than joining on a delimiter. `books_catalog.language` is free text
 * that really does contain punctuation ("Hebrew and Aramaic in Hebrew script",
 * "Latin-German"), so any separator we picked would eventually appear inside a
 * value and split it in half. Repetition has no such value to collide with.
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
  'longest',
] as const;

export type CatalogSort = (typeof CATALOG_SORTS)[number];

/** Sorts the Supabase lane can serve. `relevance` only exists inside an ask. */
export const BROWSE_SORTS = CATALOG_SORTS.filter((s) => s !== 'relevance');

export type CatalogView = 'grid' | 'list';

/**
 * `books_catalog.text_role` — is this edition the source text, a translation
 * made in its own period, or a modern one? See src/lib/text-role.ts (#2395).
 */
export const TEXT_ROLES = ['original', 'period-translation', 'modern-translation'] as const;

export const TEXT_ROLE_LABELS: Record<string, string> = {
  original: 'Original text',
  'period-translation': 'Period translation',
  'modern-translation': 'Modern translation',
};

export interface CatalogFilters {
  /** Literal title/author substring. */
  q: string;
  /** A question for the librarian — routed through the semantic lane. */
  ask: string;
  sort: CatalogSort;
  /** `books_catalog.language` — the EDITION's language (see language-fields.md). */
  languages: string[];
  collections: string[];
  categories: string[];
  /** `image_source_provider` — the library that holds the scans. */
  providers: string[];
  textRoles: string[];
  yearMin: number | null;
  yearMax: number | null;
  pagesMin: number | null;
  pagesMax: number | null;
  firstTranslation: boolean;
  hasTranslation: boolean;
  hasOcr: boolean;
  hasDoi: boolean;
  page: number;
  view: CatalogView;
}

export const DEFAULT_FILTERS: CatalogFilters = {
  q: '',
  ask: '',
  sort: 'popular',
  languages: [],
  collections: [],
  categories: [],
  providers: [],
  textRoles: [],
  yearMin: null,
  yearMax: null,
  pagesMin: null,
  pagesMax: null,
  firstTranslation: false,
  hasTranslation: false,
  hasOcr: false,
  hasDoi: false,
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

/** Longest book in the corpus is a few thousand pages; the cap is slack. */
export const PAGES_CEILING = 20000;

function clampYear(n: number): number {
  return Math.min(YEAR_CEILING, Math.max(YEAR_FLOOR, Math.round(n)));
}

function clampPages(n: number): number {
  return Math.min(PAGES_CEILING, Math.max(0, Math.round(n)));
}

/** Each value gets its own parameter. Empties and blanks are dropped. */
function setAll(p: URLSearchParams, key: string, values: string[] | undefined) {
  for (const v of values || []) {
    const trimmed = v.trim();
    if (trimmed) p.append(key, trimmed);
  }
}

/**
 * The wire names, in one place. Everything at its default is OMITTED, so an
 * untouched library keeps a clean URL and the API keeps its cache key small.
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

  setAll(p, 'language', f.languages);
  setAll(p, 'collection', f.collections);
  setAll(p, 'category', f.categories);
  setAll(p, 'provider', f.providers);
  setAll(p, 'text_role', f.textRoles);

  if (f.yearMin != null) p.set('year_min', String(clampYear(f.yearMin)));
  if (f.yearMax != null) p.set('year_max', String(clampYear(f.yearMax)));
  if (f.pagesMin != null) p.set('pages_min', String(clampPages(f.pagesMin)));
  if (f.pagesMax != null) p.set('pages_max', String(clampPages(f.pagesMax)));

  if (f.firstTranslation) p.set('first_translation', '1');
  if (f.hasTranslation) p.set('has_translation', '1');
  if (f.hasOcr) p.set('has_ocr', '1');
  if (f.hasDoi) p.set('has_doi', '1');

  if (includePage && f.page && f.page > 1) p.set('page', String(f.page));
  if (includeView && f.view && f.view !== DEFAULT_FILTERS.view) p.set('view', f.view);

  return p;
}

function readYear(raw: string | null): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? clampYear(n) : null;
}

function readPages(raw: string | null): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? clampPages(n) : null;
}

/** Deduped, blank-free, order preserved. */
function readAll(sp: URLSearchParams, key: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of sp.getAll(key)) {
    const v = raw.trim();
    if (v && !seen.has(v)) { seen.add(v); out.push(v); }
  }
  return out;
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

  let pagesMin = readPages(sp.get('pages_min'));
  let pagesMax = readPages(sp.get('pages_max'));
  if (pagesMin != null && pagesMax != null && pagesMin > pagesMax) {
    [pagesMin, pagesMax] = [pagesMax, pagesMin];
  }

  return {
    q: sp.get('q') || '',
    ask: sp.get('ask') || '',
    sort: (CATALOG_SORTS as readonly string[]).includes(sortRaw) ? (sortRaw as CatalogSort) : DEFAULT_FILTERS.sort,
    languages: readAll(sp, 'language'),
    collections: readAll(sp, 'collection'),
    categories: readAll(sp, 'category'),
    providers: readAll(sp, 'provider'),
    textRoles: readAll(sp, 'text_role').filter((r) => (TEXT_ROLES as readonly string[]).includes(r)),
    yearMin,
    yearMax,
    pagesMin,
    pagesMax,
    firstTranslation: sp.get('first_translation') === '1',
    hasTranslation: sp.get('has_translation') === '1',
    hasOcr: sp.get('has_ocr') === '1',
    hasDoi: sp.get('has_doi') === '1',
    page: Number.isFinite(page) && page > 0 ? page : 1,
    view: viewRaw === 'list' ? 'list' : 'grid',
  };
}

/** The filters that narrow the corpus — `sort`, `page` and `view` don't. */
export const NARROWING_KEYS = [
  'q',
  'ask',
  'languages',
  'collections',
  'categories',
  'providers',
  'textRoles',
  'yearMin',
  'yearMax',
  'pagesMin',
  'pagesMax',
  'firstTranslation',
  'hasTranslation',
  'hasOcr',
  'hasDoi',
] as const satisfies readonly (keyof CatalogFilters)[];

/**
 * How many conditions are narrowing the results — counted the way the chips
 * below the toolbar count, one per removable thing. Each selected value in a
 * multi-facet is its own condition; a range is one.
 */
export function countActiveFilters(f: CatalogFilters): number {
  let n = 0;
  for (const key of NARROWING_KEYS) {
    if (key === 'yearMax' && f.yearMin != null) continue; // a range counts once
    if (key === 'pagesMax' && f.pagesMin != null) continue;
    const value = f[key];
    if (Array.isArray(value)) n += value.length;
    else if (value !== DEFAULT_FILTERS[key]) n++;
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

/** Add or remove one value of a multi-value facet. */
export function toggleValue(current: string[], value: string): string[] {
  return current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
}
