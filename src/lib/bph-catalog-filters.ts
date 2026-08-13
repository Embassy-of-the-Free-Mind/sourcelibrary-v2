/**
 * The BPH catalogue search predicate, in one place.
 *
 * Two surfaces run the same search: the browsing API (`/api/catalog/bph`) and
 * the CSV export (`/api/catalog/bph/export`). They MUST agree — an export that
 * quietly matches a different set than the screen it was launched from is worse
 * than no export at all, because the librarian has no way to see the drift.
 * José Bouman, 2026-08-12, asking for the feature:
 *
 *   "Is it possible to export a search selection? I would like to have all
 *    books which have JRR in one of the fields.... This is an important
 *    feature, that we often! use!"
 *
 * So the filters live here and both routes call them. Add a filter here, never
 * in a route.
 *
 * Schema-mode fallbacks (legacy 11-column schema, missing *_norm columns, …)
 * stay in the browsing route: they are about what the database can answer, not
 * about what the user asked for.
 */

import { sanitizeFilterValue } from '@/lib/supabase';
import { normalizeBphSearchText } from '@/lib/text-normalize';

/** A PostgREST filter builder. Structurally typed so both routes' query objects fit. */
export interface FilterableQuery<T> {
  or(filters: string): T;
  eq(column: string, value: unknown): T;
  is(column: string, value: unknown): T;
  not(column: string, op: string, value: unknown): T;
  gte(column: string, value: unknown): T;
  lte(column: string, value: unknown): T;
  ilike(column: string, pattern: string): T;
  textSearch(column: string, query: string, options?: { type?: 'websearch' | 'plain' | 'phrase'; config?: string }): T;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): T;
}

export interface BphFilters {
  q: string;
  author: string;
  title: string;
  place: string;
  printer: string;
  publisher: string;
  editor: string;
  keyword: string;
  language: string;
  shelfMark: string;
  provenance: string;
  yearFrom: number | null;
  yearTo: number | null;
  digitized: string | null;
  firstTranslation: boolean;
  sort: string;
}

/** Read the filter set out of a URL. Identical parsing for both routes. */
export function readBphFilters(sp: URLSearchParams): BphFilters {
  const yearFromRaw = sp.get('yearFrom');
  const yearToRaw = sp.get('yearTo');
  return {
    q: sp.get('q')?.trim() || '',
    author: sp.get('author')?.trim() || '',
    title: sp.get('title')?.trim() || '',
    place: sp.get('place')?.trim() || '',
    printer: sp.get('printer')?.trim() || '',
    publisher: sp.get('publisher')?.trim() || '',
    editor: sp.get('editor')?.trim() || '',
    keyword: sp.get('keyword')?.trim() || '',
    language: sp.get('language')?.trim() || '',
    shelfMark: sp.get('shelf_mark')?.trim() || '',
    provenance: sp.get('provenance')?.trim() || '',
    yearFrom: yearFromRaw ? parseInt(yearFromRaw, 10) : null,
    yearTo: yearToRaw ? parseInt(yearToRaw, 10) : null,
    digitized: sp.get('digitized'),
    firstTranslation: sp.get('first_translation') === '1',
    sort: sp.get('sort') || 'title',
  };
}

/** True when no filter is set — the unfiltered catalogue view. */
export function isUnfiltered(f: BphFilters): boolean {
  return (
    !f.q && !f.author && !f.title && !f.place && !f.printer && !f.publisher && !f.editor &&
    !f.keyword && !f.language && !f.shelfMark && !f.provenance &&
    f.yearFrom === null && f.yearTo === null &&
    !f.firstTranslation
  );
}

/** What the current schema can answer. Detected and cached by the browsing route. */
export interface SchemaCaps {
  mode: 'new' | 'legacy';
  hasNormalizedColumns: boolean;
  hasFirstTranslationColumn: boolean;
}

/**
 * Apply every user-facing filter. Returns the narrowed query.
 *
 * Ordering is applied too, so a paged export walks the same sequence the screen
 * shows — otherwise "export the first 500" and "look at the first 500" differ.
 */
export function applyBphFilters<T extends FilterableQuery<T>>(query: T, f: BphFilters, caps: SchemaCaps): T {
  const { mode } = caps;
  const useNormCols = mode === 'new' && caps.hasNormalizedColumns;

  // Simple search across the whole record.
  if (f.q.length >= 2) {
    // A bare 3–4 digit query is almost always a publication year; the text
    // columns and the tsvector don't carry it, so "1545" otherwise found
    // nothing. Digits-only, so it is safe to inline into an .or() string.
    const yearQ = /^\d{3,4}$/.test(f.q) ? f.q : null;
    // UBN gets its own lane rather than living in `search_norm`, which is
    // matched with ILIKE '%q%'. UBNs are 1–5 digit numbers, so folding them in
    // would make every year search also match the UBNs containing those digits
    // (1545 would drag in 15450–15459, 11545, 21545, 31545…). Exact match for
    // an all-digit query is what "search by UBN" means; non-numeric UBNs
    // ("BPH 131", "PH144", "PH 2") still need a substring match. Reported by
    // José Bouman — searching a UBN returned nothing.
    const ubnLane = /^\d+$/.test(f.q) ? `ubn.eq.${f.q}` : `ubn.ilike.%${sanitizeFilterValue(f.q)}%`;
    if (useNormCols) {
      if (yearQ) {
        query = query.or(`search_norm.ilike.%${yearQ}%,year.eq.${yearQ},${ubnLane}`);
      } else {
        const normQ = sanitizeFilterValue(normalizeBphSearchText(f.q));
        query = normQ.length > 0 ? query.or(`search_norm.ilike.%${normQ}%,${ubnLane}`) : query.or(ubnLane);
      }
    } else if (mode === 'new') {
      if (yearQ) {
        // A tsvector match can't be OR'd with a column filter in one .or();
        // for a pure year, match the year column directly.
        query = query.eq('year', Number(yearQ));
      } else {
        query = query.textSearch('search_tsv', sanitizeFilterValue(f.q), { type: 'websearch', config: 'simple' });
      }
    } else {
      const safe = sanitizeFilterValue(f.q);
      query = yearQ
        ? query.or(`title.ilike.%${yearQ}%,author.ilike.%${yearQ}%,shelf_mark.ilike.%${yearQ}%,year.eq.${yearQ}`)
        : query.or(`title.ilike.%${safe}%,author.ilike.%${safe}%,shelf_mark.ilike.%${safe}%`);
    }
  }

  // Per-field advanced search. The `*_norm` columns roll a standard field up
  // with its variants (author_norm covers author + variant_author + pseudonym),
  // so one ilike replaces the .or() chain when they exist.
  const ilikeFilter = (col: string, val: string) => {
    if (!val) return;
    const safe = sanitizeFilterValue(val);
    const normVal = sanitizeFilterValue(normalizeBphSearchText(val));
    if (mode === 'new') {
      if (useNormCols && normVal.length > 0) {
        query = query.ilike(col === 'shelf_mark' ? 'shelf_mark_norm' : `${col}_norm`, `%${normVal}%`);
        return;
      }
      if (col === 'author') {
        query = query.or(`author.ilike.%${safe}%,variant_author.ilike.%${safe}%,pseudonym.ilike.%${safe}%`);
      } else if (col === 'title') {
        query = query.or(`title.ilike.%${safe}%,parallel_title.ilike.%${safe}%,uniform_title.ilike.%${safe}%`);
      } else if (col === 'editor') {
        query = query.or(`editor.ilike.%${safe}%,variant_editor.ilike.%${safe}%`);
      } else if (col === 'printer') {
        query = query.or(`printer.ilike.%${safe}%,variant_printer.ilike.%${safe}%`);
      } else if (col === 'publisher') {
        query = query.or(`publisher.ilike.%${safe}%,variant_publisher.ilike.%${safe}%`);
      } else if (col === 'shelf_mark') {
        query = query.or(`shelf_mark.ilike.%${safe}%,state_shelf_mark.ilike.%${safe}%`);
      } else {
        query = query.ilike(col, `%${safe}%`);
      }
    } else if (['author', 'title', 'place', 'printer', 'publisher', 'shelf_mark'].includes(col)) {
      // Legacy schema has only these; editor / language / provenance are
      // silently dropped rather than erroring.
      query = query.ilike(col, `%${safe}%`);
    }
  };
  ilikeFilter('author', f.author);
  ilikeFilter('title', f.title);
  ilikeFilter('editor', f.editor);
  ilikeFilter('place', f.place);
  ilikeFilter('printer', f.printer);
  ilikeFilter('publisher', f.publisher);
  ilikeFilter('shelf_mark', f.shelfMark);

  if (f.keyword) query = query.eq('keywords', f.keyword);
  if (mode === 'new') {
    if (f.language) query = query.eq('language', f.language);
    if (f.provenance) query = query.eq('provenance', f.provenance);
  }

  if (f.yearFrom !== null && !Number.isNaN(f.yearFrom)) query = query.gte('year', f.yearFrom);
  if (f.yearTo !== null && !Number.isNaN(f.yearTo)) query = query.lte('year', f.yearTo);

  if (f.digitized === 'true') {
    query = mode === 'new'
      ? query.or('sl_book_id.not.is.null,ia_identifier.not.is.null')
      : query.not('ia_identifier', 'is', null);
  } else if (f.digitized === 'sl' && mode === 'new') {
    query = query.not('sl_book_id', 'is', null);
  } else if (f.digitized === 'held' && mode === 'new') {
    // Catalogue entries with a non-null `present_location` are books physically
    // in the building (Leeszaal, Depot, …). Catalogue-only references and works
    // held elsewhere have null present_location. Requested by Paul Dijstelberge
    // — visitors wanted a way to see just the volumes they could ask to consult.
    query = query.not('present_location', 'is', null);
  } else if (f.digitized === 'false') {
    query = mode === 'new'
      ? query.is('sl_book_id', null).is('ia_identifier', null)
      : query.is('ia_identifier', null);
  }

  if (f.firstTranslation) {
    if (mode === 'new' && caps.hasFirstTranslationColumn) {
      query = query.eq('is_first_translation', true);
    } else {
      // No column → return nothing. PostgREST has no clean "always false"
      // predicate; use a sentinel that cannot appear in sl_book_id.
      query = query.eq('sl_book_id', '__no_first_translations__');
    }
  }

  return applyBphSort(query, f.sort);
}

/** Result ordering. nullsFirst:false everywhere so null titles never lead. */
export function applyBphSort<T extends FilterableQuery<T>>(query: T, sort: string): T {
  switch (sort) {
    case 'year_asc':
      return query.order('year', { ascending: true, nullsFirst: false }).order('title', { ascending: true });
    case 'year_desc':
      return query.order('year', { ascending: false, nullsFirst: false }).order('title', { ascending: true });
    case 'author':
      return query.order('author', { ascending: true, nullsFirst: false }).order('title', { ascending: true });
    case 'author_desc':
      return query.order('author', { ascending: false, nullsFirst: false }).order('title', { ascending: true });
    case 'title_desc':
      return query.order('title', { ascending: false, nullsFirst: false });
    case 'shelfmark':
      return query.order('shelf_mark', { ascending: true, nullsFirst: false }).order('title', { ascending: true });
    default:
      return query.order('title', { ascending: true });
  }
}
