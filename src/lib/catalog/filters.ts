/**
 * The catalogue's search state, and its one wire format.
 *
 * The page writes it to the address bar, the browse and stats routes read it
 * back, and both go through this file, so the names cannot drift apart
 * (search-filters-and-lanes.md: wire-name mismatches are the recurring
 * failure). `tests/unit/catalog-filters.test.ts` round-trips every field.
 *
 * Multi-value fields REPEAT their parameter (`?language=Latin&language=Greek`)
 * rather than joining on a delimiter: `books_catalog.language` is free text
 * that really contains punctuation ("Hebrew and Aramaic in Hebrew script").
 */

/** Results per page on the catalogue. */
export const CATALOG_PAGE_SIZE = 100;

export type CatalogSort = 'relevance' | 'popular' | 'year_asc' | 'year_desc' | 'title' | 'author';

export const CATALOG_SORTS: readonly CatalogSort[] = ['relevance', 'popular', 'year_asc', 'year_desc', 'title', 'author'];

export interface CatalogFilters {
  /** Words in the title or author, every word required. */
  q?: string;
  /** Other names for what `q` names, each searched alongside it (synonyms.ts). */
  also?: string[];
  title?: string;
  author?: string;
  /** Words that must appear in neither title nor author. */
  not?: string;
  languages?: string[];
  category?: string;
  collection?: string;
  yearMin?: number;
  yearMax?: number;
  hasTranslation?: boolean;
  firstTranslation?: boolean;
  /** Exactly these books. Not page state: the asked results use it to fetch the catalogue's own record for each work they found. */
  ids?: string[];
}

/** The whole page state: the filters plus what only the page uses. */
export interface CatalogState extends CatalogFilters {
  sort: CatalogSort;
  view: 'grid' | 'list';
  /** 1-based page of CATALOG_PAGE_SIZE results. */
  page: number;
  /** A request typed to the librarian, as typed. */
  ask?: string;
  /** What the request is about; searched inside the books, not in the catalogue. */
  topic?: string;
}

const year = (v: string | null): number | undefined => {
  if (!v) return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > -5000 && n < 3000 ? n : undefined;
};
/**
 * A text filter, without the characters the filter syntax cannot take (they are
 * stripped downstream anyway, see sanitizeFilterValue). Doing it here means a
 * search of only those (`?q=\\`) is no search at all: it shares the cached
 * whole-library numbers instead of a cold count, which took ~10 s and once
 * timed out (2026-10-18).
 */
const text = (v: string | null): string | undefined => {
  const raw = (v ?? '').trim();
  // A whole-query "phrase" keeps its pair of quotes (query.ts reads them); any other quote goes.
  const phrase = /^"[^"]+"$/.test(raw);
  const inner = (phrase ? raw.slice(1, -1) : raw).replace(/[,()"\\{}]/g, ' ').replace(/\s+/g, ' ').trim();
  const t = (phrase && inner ? `"${inner}"` : inner).slice(0, 200);
  return t || undefined;
};
const list = (vs: string[], max = 20): string[] | undefined => {
  const out = [...new Set(vs.map((v) => v.trim()).filter(Boolean))].slice(0, max);
  return out.length ? out : undefined;
};

export function parseCatalogFilters(sp: URLSearchParams): CatalogFilters {
  return {
    q: text(sp.get('q')),
    also: list(sp.getAll('also')),
    title: text(sp.get('title')),
    author: text(sp.get('author')),
    not: text(sp.get('not')),
    languages: list(sp.getAll('language')),
    category: text(sp.get('category')),
    collection: text(sp.get('collection')),
    yearMin: year(sp.get('year_min')),
    yearMax: year(sp.get('year_max')),
    hasTranslation: sp.get('has_translation') === '1' || undefined,
    firstTranslation: sp.get('first_translation') === '1' || undefined,
    ids: list(sp.getAll('id'), 120),
  };
}

/**
 * The order a state gets when none is chosen: most relevant after any words,
 * most read otherwise. A shared /library?q=alchemy link used to open in "most
 * read" while typing the same search gave "most relevant".
 */
export function defaultSort(s: CatalogFilters & { topic?: string }): CatalogSort {
  return hasTextQuery(s) ? 'relevance' : 'popular';
}

export function parseCatalogState(sp: URLSearchParams): CatalogState {
  const sort = sp.get('sort') as CatalogSort | null;
  const filters = { ...parseCatalogFilters(sp), topic: text(sp.get('topic')) };
  return {
    ...parseCatalogFilters(sp),
    sort: sort && CATALOG_SORTS.includes(sort) ? sort : defaultSort(filters),
    view: sp.get('view') === 'list' ? 'list' : 'grid',
    page: Math.min(10_000, Math.max(1, parseInt(sp.get('page') || '1', 10) || 1)),
    ask: text(sp.get('ask')),
    topic: text(sp.get('topic')),
  };
}

export function writeCatalogFilters(f: CatalogFilters, sp = new URLSearchParams()): URLSearchParams {
  if (f.q) sp.set('q', f.q);
  for (const a of f.also ?? []) sp.append('also', a);
  if (f.title) sp.set('title', f.title);
  if (f.author) sp.set('author', f.author);
  if (f.not) sp.set('not', f.not);
  for (const l of f.languages ?? []) sp.append('language', l);
  if (f.category) sp.set('category', f.category);
  if (f.collection) sp.set('collection', f.collection);
  if (f.yearMin != null) sp.set('year_min', String(f.yearMin));
  if (f.yearMax != null) sp.set('year_max', String(f.yearMax));
  if (f.hasTranslation) sp.set('has_translation', '1');
  if (f.firstTranslation) sp.set('first_translation', '1');
  for (const id of f.ids ?? []) sp.append('id', id);
  return sp;
}

export function writeCatalogState(s: CatalogState): URLSearchParams {
  const sp = new URLSearchParams();
  if (s.ask) sp.set('ask', s.ask);
  if (s.topic) sp.set('topic', s.topic);
  writeCatalogFilters(s, sp);
  if (s.sort !== defaultSort(s)) sp.set('sort', s.sort);
  if (s.view === 'list') sp.set('view', 'list');
  if (s.page > 1) sp.set('page', String(s.page));
  return sp;
}

/** Only the fields that narrow the catalogue: what the stats band counts over. */
export function catalogFiltersOf(s: CatalogFilters): CatalogFilters {
  const { q, also, title, author, not, languages, category, collection, yearMin, yearMax, hasTranslation, firstTranslation } = s;
  return { q, also, title, author, not, languages, category, collection, yearMin, yearMax, hasTranslation, firstTranslation };
}

/** Any words to rank by? Then "most relevant" is the sensible order. */
export function hasTextQuery(s: CatalogState | CatalogFilters): boolean {
  return !!(s.q || s.title || s.author || ('topic' in s && s.topic));
}

/** How many filters narrow the set (words not counted). */
export function activeFilterCount(f: CatalogFilters): number {
  return (f.languages?.length ?? 0)
    + [f.category, f.collection, f.hasTranslation, f.firstTranslation, f.not].filter(Boolean).length
    + (f.yearMin != null || f.yearMax != null ? 1 : 0);
}

/** Half-centuries 1400–1899 with an open bucket either side: the "Printed" chart. */
export const PRINTED_BUCKETS: [number | null, number | null][] = [
  [null, 1399],
  ...Array.from({ length: 10 }, (_, i): [number, number] => [1400 + i * 50, 1449 + i * 50]),
  [1900, null],
];
