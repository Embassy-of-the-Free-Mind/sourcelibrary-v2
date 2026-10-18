/**
 * The catalogue's queries: one filter builder, and the two readers of it.
 *
 * `browseCatalog` lists books; `catalogStats` counts the same set for the
 * numbers band (works, translated, when printed, languages). Both apply
 * `applyCatalogFilters`, so the band can never count a different set from the
 * grid beneath it.
 *
 * PRIOR ART: `browseBooks` (books-catalog.ts) — single language, one substring
 * over title/author, no exclusions. It stays as is for its other callers
 * (/browse, /libraries, collection pages); this adds what the catalogue page's
 * Advanced search needs. The title/author matching reuses `catalogOrFilter`,
 * the same expression the site search's book lane uses, word forms included.
 */
import { unstable_cache } from 'next/cache';
import { supabase, sanitizeFilterValue } from '@/lib/supabase';
import { NON_ARTWORK_FILTERS } from '@/lib/artwork-record';
import { isSingleRealLanguage } from '@/lib/language-canonical';
import { READABLE_RUNGS, ENGLISH_ORIGINAL_READABLE_RUNGS, type TranslationRung } from '@/lib/page-counts';
import {
  READABLE_IN_ENGLISH_OR, applySort, attachCardVariants, bookSelect, canonicalizeCategory, catalogOrFilter,
  type CatalogBook,
} from '@/lib/books-catalog';
import { PRINTED_BUCKETS, type CatalogFilters, type CatalogSort } from '@/lib/catalog/filters';
import { foldSynonymText } from '@/lib/catalog/synonyms';

const words = (t?: string) => sanitizeFilterValue(t ?? '').trim().split(/\s+/).filter((w) => w.length >= 2);
const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * An other name (synonyms.ts) as a title match. Each of its words must START a
 * word in the title or display title (`imatch` + `\m`, served by the trigram
 * index), so "pest" finds Pest-Ordnung but not Budapest or tempest. Author is
 * not searched: other names are subjects, not people.
 */
function otherNameClause(name: string): string | null {
  const ws = words(name);
  if (!ws.length) return null;
  const one = (w: string) => `or(title.imatch.\\m${reEscape(w)},display_title.imatch.\\m${reEscape(w)})`;
  return ws.length === 1 ? one(ws[0]).slice(3, -1) : `and(${ws.map(one).join(',')})`;
}

/** The title/author part: the words as typed, their related forms, and every other name. */
function textOr(f: CatalogFilters): string | null {
  if (!f.q?.trim()) return null;
  const isPhrase = /^".*"$/.test(f.q.trim());
  const q = isPhrase ? f.q.trim().slice(1, -1) : f.q;
  const parts = new Set([
    catalogOrFilter(q, { isPhrase, fold: false, authors: true }),
    catalogOrFilter(q, { isPhrase, fold: true, authors: true }),
  ]);
  for (const name of f.also ?? []) {
    const c = otherNameClause(name);
    if (c) parts.add(c);
  }
  return [...parts].join(',');
}

/** Every catalogue filter, onto a `books_catalog` query. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyCatalogFilters(query: any, f: CatalogFilters, opts: { ignoreYears?: boolean } = {}): any {
  let q = query.eq('visible', true).gt('pages_count', 0);
  // Artworks share this table; a book card for a Met stela is the wrong promise
  // (search-filters-and-lanes.md, #4415). The chained `or` form keeps the
  // 19k rows whose content_type is NULL.
  for (const a of NON_ARTWORK_FILTERS) q = q.or(a);

  const text = textOr(f);
  if (text) q = q.or(text);
  for (const w of words(f.title)) q = q.or(`title.ilike.%${w}%,display_title.ilike.%${w}%`);
  for (const w of words(f.author)) q = q.ilike('author', `%${w}%`);
  for (const w of words(f.not)) {
    // A NOT on a nullable column drops its NULL rows (three-valued logic), so
    // the empty column is let through explicitly.
    q = q.not('title', 'ilike', `%${w}%`)
      .or(`display_title.is.null,display_title.not.ilike.%${w}%`)
      .or(`author.is.null,author.not.ilike.%${w}%`);
  }

  if (f.ids?.length) q = q.in('id', f.ids);
  if (f.languages?.length === 1) q = q.eq('language', f.languages[0]);
  else if (f.languages?.length) q = q.in('language', f.languages);
  if (f.category) q = q.contains('categories', [canonicalizeCategory(f.category)]);
  if (f.collection) q = q.contains('collections', [f.collection]);
  if (f.hasTranslation) q = q.or(READABLE_IN_ENGLISH_OR);
  if (f.firstTranslation) q = q.eq('is_first_translation', true);
  if (!opts.ignoreYears) {
    // An undated edition cannot satisfy a bounded range; it drops out, as in browseBooks.
    if (f.yearMin != null) q = q.gte('year', f.yearMin);
    if (f.yearMax != null) q = q.lte('year', f.yearMax);
  }
  return q;
}

/* ------------------------------------------------------------------ browse */

/** Rows ranked in memory for "most relevant"; PostgREST's response cap. */
const RANK_POOL = 1000;

/**
 * Title words count most, then the author, then other names; how much a book
 * is read breaks ties. There is no relevance order in SQL to borrow — the
 * trigram index finds, it does not rank.
 */
export function relevanceScore(b: Pick<CatalogBook, 'title' | 'display_title' | 'author' | 'read_count'> & { human_read_count?: number | null }, f: CatalogFilters): number {
  const dt = foldSynonymText(b.display_title || b.title || '');
  const ti = foldSynonymText(`${b.title} ${b.display_title ?? ''}`);
  const au = foldSynonymText(b.author ?? '');
  const own = [...words(f.q), ...words(f.title)].map(foldSynonymText);
  const phrase = own.join(' ');
  let n = 0;
  for (const w of own) {
    const e = reEscape(w);
    n += new RegExp(`\\b${e}\\b`).test(dt) ? 4 : new RegExp(`\\b${e}`).test(ti) ? 2 : 0;
    if (au.includes(w)) n += 3;
  }
  for (const w of words(f.author).map(foldSynonymText)) if (au.includes(w)) n += 3;
  if (phrase && dt.startsWith(phrase)) n += 4;
  if (phrase && dt === phrase) n += 6;
  if (!n) for (const name of f.also ?? []) if (ti.includes(foldSynonymText(name))) { n = 1; break; }
  return n + Math.log10(1 + (b.human_read_count ?? b.read_count ?? 0));
}

export async function browseCatalog(f: CatalogFilters, sort: CatalogSort, page = 1, limit = 48): Promise<{ books: CatalogBook[]; total: number }> {
  // "Most relevant" ranks the first RANK_POOL matches in memory; pages past
  // the pool continue in most-read order rather than ending early.
  const ranked = sort === 'relevance' && !!(f.q || f.title || f.author) && page * limit <= RANK_POOL;
  const select = ranked ? `${await bookSelect()}, human_read_count` : await bookSelect();
  let query = applyCatalogFilters(supabase.from('books_catalog').select(select, { count: 'exact' }), f);
  query = applySort(query, ranked || sort === 'relevance' ? 'popular' : sort);
  const from = ranked ? 0 : (page - 1) * limit;
  query = query.range(from, ranked ? RANK_POOL - 1 : from + limit - 1);

  const { data, count, error } = await query;
  if (error) {
    // Offset past the end: an empty page, not a failure (see browseBooks).
    if (error.code === 'PGRST103' || /range not satisfiable/i.test(error.message)) return { books: [], total: count || 0 };
    throw new Error(`catalogue query failed: ${error.message}`);
  }
  let rows = (data || []) as unknown as (CatalogBook & { human_read_count?: number | null })[];
  if (ranked) {
    rows = rows
      .map((b) => ({ b, s: relevanceScore(b, f) }))
      .sort((a, z) => z.s - a.s)
      .map(({ b }) => b)
      .slice((page - 1) * limit, page * limit);
  }
  return { books: await attachCardVariants(rows), total: count || 0 };
}

/**
 * Supabase sits behind Cloudflare, whose firewall refuses requests that look
 * like SQL injection (`'; DROP TABLE books;--`, measured 2026-10-18) with an
 * HTML block page. That is a search nothing can match, not a failure: callers
 * answer it as an empty result rather than a 500.
 */
export function isUpstreamBlock(err: unknown): boolean {
  const m = (err as Error)?.message ?? '';
  return /Attention Required!|cf-error-details|Cloudflare/i.test(m);
}

/* ------------------------------------------------------------------- stats */

export interface CatalogStats {
  total: number;
  /** Readable in English now (READABLE_IN_ENGLISH_OR). */
  translated: number;
  /** Distinct single real languages (isSingleRealLanguage). */
  languageCount: number;
  /** Every language label with its count, largest first. */
  languages: { value: string; count: number }[];
  /** Half-centuries from 1400 to 1899, with an open bucket either side. Ignores the year filter, so the chart shows where the selection sits. */
  printed: { from: number | null; to: number | null; count: number }[];
  /** Earliest and latest dated work, over the same span the chart shows. */
  yearFirst: number | null;
  yearLast: number | null;
}


type StatRow = { language: string | null; year: number | null; translation_rung: TranslationRung | null; english_original: boolean | null };

const PAGE = 1000;
const PARALLEL = 6;

/**
 * Every matching row's stat columns, paged past the 1,000-row response cap.
 * Ordered by id: unordered `.range()` windows overlap and skip, and identical
 * loads then disagree (#4236 measured 101, 112, 116 languages).
 */
async function sweep(columns: string, f: CatalogFilters, ignoreYears: boolean): Promise<StatRow[]> {
  const base = () => applyCatalogFilters(supabase.from('books_catalog').select(columns, { count: 'exact' }), f, { ignoreYears }).order('id', { ascending: true });
  const first = await base().range(0, PAGE - 1);
  if (first.error) throw new Error(`catalogue stats failed: ${first.error.message}`);
  const rows = [...((first.data || []) as unknown as StatRow[])];
  const total = first.count ?? rows.length;
  const offsets: number[] = [];
  for (let o = PAGE; o < total; o += PAGE) offsets.push(o);
  for (let i = 0; i < offsets.length; i += PARALLEL) {
    const pages = await Promise.all(offsets.slice(i, i + PARALLEL).map(async (o) => {
      const r = await base().range(o, o + PAGE - 1);
      if (r.error) throw new Error(`catalogue stats failed: ${r.error.message}`);
      return (r.data || []) as unknown as StatRow[];
    }));
    for (const p of pages) rows.push(...p);
  }
  return rows;
}

const readable = (r: StatRow) => !!r.translation_rung && (
  READABLE_RUNGS.includes(r.translation_rung)
  || (!!r.english_original && ENGLISH_ORIGINAL_READABLE_RUNGS.includes(r.translation_rung)));

async function computeStats(f: CatalogFilters): Promise<CatalogStats> {
  const hasYears = f.yearMin != null || f.yearMax != null;
  const [rows, span] = await Promise.all([
    sweep('language, year, translation_rung, english_original', f, false),
    hasYears ? sweep('year', f, true) : Promise.resolve(null),
  ]);
  const langs = new Map<string, number>();
  for (const r of rows) if (r.language) langs.set(r.language, (langs.get(r.language) || 0) + 1);
  const years = (span ?? rows).map((r) => r.year).filter((y): y is number => typeof y === 'number');
  return {
    total: rows.length,
    translated: rows.filter(readable).length,
    languageCount: [...langs.keys()].filter((l) => isSingleRealLanguage(l)).length,
    languages: [...langs].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count),
    printed: PRINTED_BUCKETS.map(([from, to]) => ({
      from, to,
      count: years.filter((y) => (from == null || y >= from) && (to == null || y <= to)).length,
    })),
    // reduce, not Math.min(...years): a 40k-element spread can overflow the call stack.
    yearFirst: years.length ? years.reduce((a, y) => (y < a ? y : a)) : null,
    yearLast: years.length ? years.reduce((a, y) => (y > a ? y : a)) : null,
  };
}

/** Exact numbers for the band, cached an hour per filter set. */
export async function catalogStats(f: CatalogFilters): Promise<CatalogStats> {
  const key = JSON.stringify(f, Object.keys(f).sort());
  return unstable_cache(() => computeStats(f), ['catalog-stats-v1', key], { revalidate: 3600, tags: ['catalog-stats'] })();
}
