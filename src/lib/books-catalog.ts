/**
 * Supabase books_catalog query helpers.
 *
 * Shared data layer for browse/language/library pages that read from
 * the Supabase books_catalog mirror instead of MongoDB.
 *
 * The books_catalog table is synced from MongoDB every 5 minutes
 * via the Hetzner supabase-sync cron.
 */

import { supabase, supabaseAdmin, sanitizeFilterValue } from '@/lib/supabase';
import { isSingleRealLanguage, distinctLanguageSet } from '@/lib/language-canonical';

/**
 * Canonical form of a category value: lowercase, trimmed, spaces → hyphens.
 * The curated category ids (LIBRARY_CATEGORIES) are all canonical, but the
 * AI-assigned `categories` array historically drifted into mixed casings/forms
 * ("Philosophy", "Natural Philosophy") — and `categories @> [x]` matching is
 * exact + case-sensitive, so those books silently dropped out of their category
 * page/search (e.g. ~813 "Freemasonry" books missing from /categories/freemasonry).
 * Apply this to both the stored values (backfill + write path) and the query
 * param so they always meet. Keep in sync with the .mjs writer canonicalizer in
 * scripts/workers/pipeline-orchestrator.mjs.
 */
export function canonicalizeCategory(cat: string): string {
  return cat.toLowerCase().trim().replace(/\s+/g, '-');
}

export interface CatalogBook {
  id: string;
  slug: string | null;
  title: string;
  display_title: string | null;
  author: string | null;
  year: number | null;
  language: string | null;
  published: string | null;
  pages_count: number;
  pages_ocr: number;
  pages_translated: number;
  /**
   * Pages carrying a Spanish edition (#4166). Mirrors `books.pages_translated_es`.
   * Read it only through `hasLocalizedEdition()` — a book WRITTEN in Spanish has
   * no translated pages and would score zero here (#4120). Without this field a
   * catalog-fed `CollectionBookCard` cannot tell a Spanish-readable book from an
   * English-only one and links every card to its English page.
   */
  pages_translated_es: number;
  pages_blank: number;
  photo: string | null;
  thumbnail: string | null;
  thumbnail_blob: string | null;
  read_count: number;
  is_first_translation: boolean;
  quality_score: number;
  image_source_provider: string | null;
  categories: string[];
  collections: string[];
  resource_type: string | null;
  /** original | period-translation | modern-translation — see src/lib/text-role.ts (#2395) */
  text_role: string | null;
  place_published: string | null;
}

/** Extended book detail from Supabase — includes fields for the /book/[id] page shell. */
export interface CatalogBookDetail extends CatalogBook {
  contributing_library: string | null;
  summary_text: string | null;
  publisher: string | null;
  place_published: string | null;
  doi: string | null;
  work_id: string | null;
  source_url: string | null;
  provider_name: string | null;
  image_attribution: string | null;
  image_license: string | null;
  cover_image: string | null;
  dedication: string | null;
  subtitle: string | null;
  source_work_dates: Array<{ type: string; date_display: string; author?: string }> | null;
  ft_disposition: string | null;
  ft_reasoning: string | null;
  // Graded FT verdict + screens (#3726 Tier 3): raw projections of
  // books.first_translation.* and the #3524 screens, so card surfaces can
  // compute the claim register via ftRenderProps without an Atlas fetch.
  ft_verdict: string | null;
  ft_evidence_strength: string | null;
  ft_our_completeness: string | null;
  ft_source_screen: string | null;
  ft_translator_screen: string | null;
  description: string | null;
  subject_keywords: string[] | null;
  created_at: string | null;
  updated_at: string | null;
}

// Exported so tests can assert the localization counter is in it (#4166) —
// a card cannot tell a Spanish-readable book from an English-only one without
// a field the query never asked for.
export const BOOK_SELECT = 'id, slug, title, display_title, author, year, language, published, pages_count, pages_ocr, pages_translated, pages_translated_es, pages_blank, photo, thumbnail, thumbnail_blob, read_count, is_first_translation, quality_score, image_source_provider, categories, collections, resource_type, text_role, place_published, ft_verdict, ft_evidence_strength, ft_our_completeness, ft_source_screen, ft_translator_screen';

export type SortOption = 'popular' | 'title' | 'author' | 'year_asc' | 'year_desc' | 'recent' | 'last_translated' | 'quality';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applySort(query: any, sort: SortOption) {
  switch (sort) {
    case 'title': return query.order('sort_title', { ascending: true });
    case 'year_asc': return query.order('year', { ascending: true, nullsFirst: false }).order('title', { ascending: true });
    case 'year_desc': return query.order('year', { ascending: false, nullsFirst: false }).order('title', { ascending: true });
    case 'author': return query.order('author', { ascending: true, nullsFirst: false }).order('title', { ascending: true });
    case 'recent': return query.order('created_at', { ascending: false });
    case 'last_translated': return query.order('last_translation_at', { ascending: false, nullsFirst: false }).order('title', { ascending: true });
    case 'quality': return query.order('quality_score', { ascending: false }).order('title', { ascending: true });
    case 'popular':
    default: return query.order('read_count', { ascending: false, nullsFirst: false }).order('title', { ascending: true });
  }
}

/**
 * Browse books with filters, sorting, and pagination.
 * Returns { books, total }.
 */
export async function browseBooks(opts: {
  language?: string;
  collection?: string;
  category?: string;
  provider?: string;
  library?: string;
  /** `is_first_translation` alone — the bibliographic claim, badged or not. */
  firstTranslation?: boolean;
  /**
   * The claim AND the translation that makes it visible, i.e. the same gate the
   * "First Translation" badge renders behind (`isPublishedFirstTranslation`).
   *
   * `is_first_translation: true` is set by batch-flag scripts before the
   * translation exists (`visibility-and-stats.md`), so the bare flag returns
   * books whose cards carry no badge — a filter whose result set visibly
   * disagrees with the count that offered it. Surfaces that let a reader ASK
   * for first translations want this one; a bibliographic census wants the flag.
   */
  firstTranslationPublished?: boolean;
  hasTranslation?: boolean;
  /** Only books with at least one transcribed page. */
  hasOcr?: boolean;
  hasPages?: boolean;
  /** Only return items with resource_type set (artworks) */
  hasResourceType?: boolean;
  /**
   * Restrict to these book ids. The metadata predicates below still apply, so a
   * vector lane that hands its hits in here is filtered by the SAME SQL as an
   * ordinary browse — the leak `search-filters-and-lanes.md` warns about
   * ("vector lanes carry no metadata predicate") cannot happen through it.
   */
  ids?: string[];
  yearMin?: number;
  yearMax?: number;
  titlePrefix?: string;
  authorPrefix?: string;
  search?: string;
  sort?: SortOption;
  offset?: number;
  limit?: number;
  /** Skip count: use 'planned' instead of 'exact' to avoid expensive seq scans.
   *  Default changed to 'planned' because 'exact' causes Supabase statement timeouts
   *  on 17K+ rows with filter conditions on unindexed columns. */
  skipCount?: boolean;
  /** Request exact count — only use for client-side paginated requests where accuracy matters. */
  exactCount?: boolean;
}): Promise<{ books: CatalogBook[]; total: number }> {
  const limit = opts.limit || 60;
  const offset = opts.offset || 0;

  // Default to 'planned' (fast estimate) to avoid Supabase statement timeouts.
  // Only use 'exact' when explicitly requested (e.g. client-side pagination).
  const countMode = opts.exactCount ? 'exact' : (opts.skipCount ? 'planned' : 'estimated');

  let query = supabase
    .from('books_catalog')
    .select(BOOK_SELECT, { count: countMode })
    .eq('visible', true);

  if (opts.hasPages !== false) query = query.gt('pages_count', 0);
  if (opts.hasTranslation) query = query.gt('pages_translated', 0);
  if (opts.hasOcr) query = query.gt('pages_ocr', 0);
  if (opts.hasResourceType) query = query.not('resource_type', 'is', null);
  if (opts.ids) query = query.in('id', opts.ids);
  if (opts.language) query = query.eq('language', opts.language);
  if (opts.collection) query = query.contains('collections', [opts.collection]);
  if (opts.category) query = query.contains('categories', [canonicalizeCategory(opts.category)]);
  if (opts.provider) query = query.eq('image_source_provider', opts.provider);
  if (opts.library === 'bhutan') query = query.ilike('source_url', '%eap.bl.uk%');
  if (opts.firstTranslation) query = query.eq('is_first_translation', true);
  if (opts.firstTranslationPublished) query = query.eq('is_first_translation', true).gt('pages_translated', 0);
  if (opts.yearMin != null) query = query.gte('year', opts.yearMin);
  if (opts.yearMax != null) query = query.lte('year', opts.yearMax);
  if (opts.titlePrefix) { const s = sanitizeFilterValue(opts.titlePrefix); query = query.or(`display_title.ilike.${s}%,title.ilike.${s}%`); }
  if (opts.authorPrefix) query = query.ilike('author', `${sanitizeFilterValue(opts.authorPrefix)}%`);
  if (opts.search) { const s = sanitizeFilterValue(opts.search); query = query.or(`title.ilike.%${s}%,display_title.ilike.%${s}%,author.ilike.%${s}%`); }

  query = applySort(query, opts.sort || 'popular');
  query = query.range(offset, offset + limit - 1);

  const { data, count, error } = await query;
  if (error) {
    // PostgREST returns 416 "Requested range not satisfiable" (PGRST103) when the
    // requested offset is past the end of the result set — e.g. a bot or a stale
    // pagination link hitting /libraries/[slug]?offset=60 on a provider with <60
    // visible books. That's an empty page, not a server error, so don't throw
    // (it was 500-ing library pages). The 416 response still carries the total in
    // the Content-Range header, which supabase-js surfaces as `count`.
    if (error.code === 'PGRST103' || /range not satisfiable/i.test(error.message)) {
      return { books: [], total: count || 0 };
    }
    throw new Error(`books_catalog query failed: ${error.message}`);
  }

  return { books: (data || []) as CatalogBook[], total: count || 0 };
}

/**
 * Count books matching a filter.
 */
export async function countBooks(filter: {
  language?: string;
  provider?: string;
  collection?: string;
  firstTranslation?: boolean;
  hasPages?: boolean;
  hasTranslation?: boolean;
}): Promise<number> {
  let query = supabase
    .from('books_catalog')
    .select('id', { count: 'exact', head: true })
    .eq('visible', true);

  if (filter.hasPages !== false) query = query.gt('pages_count', 0);
  if (filter.hasTranslation) query = query.gt('pages_translated', 0);
  if (filter.language) query = query.eq('language', filter.language);
  if (filter.provider) query = query.eq('image_source_provider', filter.provider);
  if (filter.collection) query = query.contains('collections', [filter.collection]);
  if (filter.firstTranslation) query = query.eq('is_first_translation', true);

  const { count } = await query;
  return count || 0;
}

/**
 * Get distinct language counts for a provider or collection.
 */
/**
 * Fetch ALL visible, processed books_catalog rows for the given columns,
 * paginating past PostgREST's hard 1000-row response cap.
 *
 * CRITICAL: `.limit(20000)` does NOT raise this cap — PostgREST clamps every
 * response to its server-side `db-max-rows` (1000 here), so any code that pulls
 * rows to aggregate in JS must page with `.range()`. Counting from a single
 * 1000-row page silently undercounts everything (e.g. Chinese once read 49 of
 * its real 683). `apply` adds per-call filters (provider, collection, …).
 */
export async function fetchAllVisibleCatalogRows<T = Record<string, unknown>>(
  columns: string,
  apply?: (q: any) => any,
): Promise<T[]> {
  const PAGE = 1000;
  const all: T[] = [];
  let offset = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let query = supabase
      .from('books_catalog')
      .select(columns)
      .eq('visible', true)
      .gt('pages_count', 0)
      .range(offset, offset + PAGE - 1);
    if (apply) query = apply(query);

    const { data, error } = await query;
    if (error) throw new Error(`books_catalog page query failed: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

export async function getLanguageCounts(filter: {
  provider?: string;
  collection?: string;
}): Promise<{ lang: string; count: number }[]> {
  const rows = await fetchAllVisibleCatalogRows<{ language: string | null }>('language', (q) => {
    let query = q;
    if (filter.provider) query = query.eq('image_source_provider', filter.provider);
    if (filter.collection) query = query.contains('collections', [filter.collection]);
    return query;
  });

  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.language) counts.set(row.language, (counts.get(row.language) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([lang, count]) => ({ lang, count }))
    // Drop junk labels ("e") and multi-language "collab" labels ("Greek/Latin",
    // "German-English"): keep only single real languages, whose raw label still
    // matches the exact `eq('language', value)` filter in browseBooks. See
    // src/lib/language-canonical.ts.
    .filter(({ lang }) => isSingleRealLanguage(lang))
    .sort((a, b) => b.count - a.count);
}

/**
 * Browse authors by letter prefix.
 * Returns alphabetically sorted list of { name, count } for authors
 * whose names start with the given letter and have translations.
 */
export async function browseAuthors(letter: string): Promise<{ name: string; count: number }[]> {
  // Supabase PostgREST caps responses at 1000 rows. Letter A has ~1100 books,
  // so we paginate to get all results.
  const allRows: { author: string | null }[] = [];
  const PAGE = 1000;
  let offset = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase
      .from('books_catalog')
      .select('author')
      .eq('visible', true)
      .gt('pages_count', 0)
      .gt('pages_translated', 0)
      .ilike('author', `${letter}%`)
      .range(offset, offset + PAGE - 1);

    if (error) throw new Error(`browseAuthors query failed: ${error.message}`);
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  // Group by author and count
  const counts = new Map<string, number>();
  for (const row of allRows) {
    if (row.author) counts.set(row.author, (counts.get(row.author) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Visual resource types that identify an artist (vs text author) */
export const VISUAL_RESOURCE_TYPES = ['painting', 'drawing', 'print', 'fresco', 'engraving', 'woodcut'];

/**
 * Browse artists by letter prefix.
 * Artists are authors of visual works (paintings, prints, drawings, etc.).
 *
 * Groups by authorSlug to merge name variants ("Hendrick Goltzius",
 * "Goltzius, Hendrick", etc.) into a single entry. Uses the most common
 * variant as the display name. Filters by letter on the display name.
 */
export async function browseArtists(letter: string): Promise<{ name: string; count: number }[]> {
  // Fetch ALL visible visual works (no letter filter — we filter after grouping)
  const allRows: { author: string | null }[] = [];
  const PAGE = 1000;
  let offset = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase
      .from('books_catalog')
      .select('author')
      .eq('visible', true)
      .in('resource_type', VISUAL_RESOURCE_TYPES)
      .range(offset, offset + PAGE - 1);

    if (error) throw new Error(`browseArtists query failed: ${error.message}`);
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  // Group by slug to merge name variants
  const { authorSlug } = await import('@/lib/slugify');
  const slugGroups = new Map<string, Map<string, number>>();
  for (const row of allRows) {
    if (!row.author || row.author === 'Unknown' || row.author === 'Anonymous') continue;
    const slug = authorSlug(row.author);
    if (!slugGroups.has(slug)) slugGroups.set(slug, new Map());
    const variants = slugGroups.get(slug)!;
    variants.set(row.author, (variants.get(row.author) || 0) + 1);
  }

  // Pick the most common variant as display name, sum all counts
  const results: { name: string; count: number }[] = [];
  for (const [, variants] of slugGroups) {
    let bestName = '';
    let bestCount = 0;
    let total = 0;
    for (const [name, count] of variants) {
      total += count;
      if (count > bestCount) { bestName = name; bestCount = count; }
    }
    // Filter by letter on display name
    if (bestName.toUpperCase().startsWith(letter.toUpperCase())) {
      results.push({ name: bestName, count: total });
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

/** Select string for search results — includes summary_text and doi for display */
const SEARCH_SELECT = `${BOOK_SELECT}, summary_text, doi, work_id`;

/**
 * Author alias groups. Each group lists name variants that should be treated as
 * equivalent at search time — querying any member surfaces records whose author
 * field matches any other member.
 *
 * Why: the books_catalog `author` column stores a single display form (e.g.
 * "C.G. Jung" on one record, "Carl Gustav Jung" on another). Without aliasing,
 * a search for "carl jung" misses the "C.G. Jung" record entirely.
 */
const AUTHOR_ALIAS_GROUPS: string[][] = [
  ['carl jung', 'carl gustav jung', 'c.g. jung'],
];

/**
 * Search books by title/author text — returns full metadata for search display.
 *
 * Single Supabase query replaces the old two-hop pattern:
 *   searchBookIds → MongoDB $in lookup (~1s)
 * Now: trigram search + filters + metadata in one query (~200ms).
 */
export async function searchBooksCatalog(
  text: string,
  opts?: {
    limit?: number;
    language?: string;
    category?: string;
    firstTranslation?: boolean;
    hasTranslation?: boolean;
    library?: string;
    yearMin?: number;
    yearMax?: number;
  }
): Promise<CatalogBookDetail[]> {
  const limit = opts?.limit || 20;

  // Detect quoted phrase: "venus humanitas" → exact phrase only, no word splitting
  const isPhrase = /^".*"$/.test(text.trim());
  const searchText = isPhrase ? text.trim().slice(1, -1) : text;

  // Build OR filter — same logic as searchBookIds
  const safe = sanitizeFilterValue(searchText);
  const STOPWORDS = new Set(['a', 'an', 'and', 'at', 'by', 'de', 'der', 'des', 'di', 'du', 'el', 'en', 'et', 'for', 'from', 'in', 'la', 'le', 'les', 'of', 'on', 'or', 'the', 'to', 'und', 'von', 'with']);
  const words = safe.trim().split(/\s+/).filter(w => w.length >= 2);
  const contentWords = words.filter(w => w.length >= 3 && !STOPWORDS.has(w.toLowerCase()));
  const phraseFilters = `title.ilike.%${safe}%,display_title.ilike.%${safe}%,author.ilike.%${safe}%`;

  // For quoted phrases, only do exact phrase matching — no word splitting or cross-field matching
  let orFilter = phraseFilters;
  if (isPhrase) {
    // Exact phrase only — already handled by phraseFilters
  } else if (words.length >= 2) {
    const titleAnds = words.map(w => `title.ilike.%${w}%`).join(',');
    const displayAnds = words.map(w => `display_title.ilike.%${w}%`).join(',');
    const authorAnds = words.map(w => `author.ilike.%${w}%`).join(',');
    orFilter += `,and(${titleAnds}),and(${displayAnds}),and(${authorAnds})`;

    // Author alias expansion: if the query matches a known alias group, also
    // search authors using each alternate variant in the group.
    const lowerSafe = safe.toLowerCase();
    const aliasGroup = AUTHOR_ALIAS_GROUPS.find(group => group.some(a => lowerSafe.includes(a)));
    if (aliasGroup) {
      for (const variant of aliasGroup) {
        if (lowerSafe.includes(variant)) continue;
        const variantWords = variant.split(/\s+/).filter(w => w.length >= 2);
        if (variantWords.length < 2) continue;
        const variantAnds = variantWords.map(w => `author.ilike.%${w}%`).join(',');
        orFilter += `,and(${variantAnds})`;
      }
    }

    // Cross-field AND: author + title words (catches "newton principia")
    if (contentWords.length >= 2 && contentWords.length <= 3) {
      for (const w of contentWords) {
        const others = contentWords.filter(o => o !== w);
        const titlePart = others.map(o => `title.ilike.%${o}%`).join(',');
        const displayPart = others.map(o => `display_title.ilike.%${o}%`).join(',');
        orFilter += `,and(author.ilike.%${w}%,${titlePart})`;
        orFilter += `,and(author.ilike.%${w}%,${displayPart})`;
      }
    }
  } else {
    // Single word: also match against language and subject_keywords
    orFilter += `,language.ilike.%${safe}%`;
    // subject_keywords array contains — catches "panchatantra", "alchemy", etc.
    orFilter += `,subject_keywords.cs.{"${safe}"}`;
  }

  let query = supabase
    .from('books_catalog')
    .select(SEARCH_SELECT)
    .eq('visible', true)
    .gt('pages_count', 0)
    .or(orFilter)
    .limit(limit);

  if (opts?.language) query = query.eq('language', opts.language);
  if (opts?.category) query = query.contains('categories', [canonicalizeCategory(opts.category)]);
  if (opts?.firstTranslation) query = query.eq('is_first_translation', true);
  if (opts?.hasTranslation) query = query.gt('pages_translated', 0);
  // Publication-year range. Rows with a null year drop out of a bounded range,
  // same as listBooksCatalog — an undated edition can't satisfy "after 1600".
  if (opts?.yearMin != null) query = query.gte('year', opts.yearMin);
  if (opts?.yearMax != null) query = query.lte('year', opts.yearMax);
  if (opts?.library === 'bhutan') query = query.ilike('source_url', '%eap.bl.uk%');
  else if (opts?.library) query = query.eq('image_source_provider', opts.library);

  const { data, error } = await query;
  if (error) throw new Error(`searchBooksCatalog failed: ${error.message}`);
  return (data || []) as unknown as CatalogBookDetail[];
}

/**
 * Search books by title/author text — returns matching book IDs.
 *
 * Use this instead of MongoDB regex queries on books.title/author.
 * Supabase has trigram GIN indexes on these columns, making ILIKE
 * queries ~100x faster than MongoDB collection scans.
 *
 * Pattern for scripts that need full book data from MongoDB:
 *   const ids = await searchBookIds('iamblichus');
 *   const books = await db.collection('books').find({ id: { $in: ids } }).toArray();
 */
export async function searchBookIds(
  text: string,
  opts?: { includeHidden?: boolean; limit?: number }
): Promise<string[]> {
  const limit = opts?.limit || 500;

  // Detect quoted phrase: "venus humanitas" → exact phrase only
  const isPhrase = /^".*"$/.test(text.trim());
  const searchText = isPhrase ? text.trim().slice(1, -1) : text;

  // Build OR filter: exact phrase match + word-level AND matches
  // "mathematical magick" should match "Mathematicall Magick" by matching each word
  const safe = sanitizeFilterValue(searchText);
  const STOPWORDS = new Set(['a', 'an', 'and', 'at', 'by', 'de', 'der', 'des', 'di', 'du', 'el', 'en', 'et', 'for', 'from', 'in', 'la', 'le', 'les', 'of', 'on', 'or', 'the', 'to', 'und', 'von', 'with']);
  const words = safe.trim().split(/\s+/).filter(w => w.length >= 2);
  const contentWords = words.filter(w => w.length >= 3 && !STOPWORDS.has(w.toLowerCase()));
  // Only ilike on indexed/short fields — summary_text and description cause
  // full-table scans and Supabase statement timeouts (no trigram indexes)
  const phraseFilters = `title.ilike.%${safe}%,display_title.ilike.%${safe}%,author.ilike.%${safe}%`;

  // For quoted phrases, only do exact phrase matching
  let orFilter = phraseFilters;
  if (isPhrase) {
    // Exact phrase only — already handled by phraseFilters
  } else if (words.length >= 2) {
    // Add word-level AND: title contains ALL words (handles spelling variants)
    const titleAnds = words.map(w => `title.ilike.%${w}%`).join(',');
    const displayAnds = words.map(w => `display_title.ilike.%${w}%`).join(',');
    orFilter += `,and(${titleAnds}),and(${displayAnds})`;

    // Cross-field AND: some words in title + some in author
    // Catches "newton principia" where "newton" is author and "principia" is in title
    // Only add if we have 2-3 words (more would be too loose)
    if (contentWords.length >= 2 && contentWords.length <= 3) {
      for (const w of contentWords) {
        const others = contentWords.filter(o => o !== w);
        const titlePart = others.map(o => `title.ilike.%${o}%`).join(',');
        const displayPart = others.map(o => `display_title.ilike.%${o}%`).join(',');
        orFilter += `,and(author.ilike.%${w}%,${titlePart})`;
        orFilter += `,and(author.ilike.%${w}%,${displayPart})`;
      }
    }
  } else {
    // Single word: also match against language (e.g. "Sanskrit", "Arabic")
    // This is fast since it's a single ilike on an indexed field
    orFilter += `,language.ilike.%${safe}%`;
    // subject_keywords array contains — catches terms like "panchatantra", "alchemy", "metallurgy"
    orFilter += `,subject_keywords.cs.{"${safe}"}`;
  }

  let query = supabase
    .from('books_catalog')
    .select('id')
    .gt('pages_count', 0)
    .or(orFilter)
    .limit(limit);

  if (!opts?.includeHidden) query = query.eq('visible', true);

  const { data, error } = await query;
  if (error) throw new Error(`searchBookIds failed: ${error.message}`);
  return (data || []).map(row => row.id);
}

// ── Catalogue facets ─────────────────────────────────────────────────────────

export interface FacetValue {
  value: string;
  count: number;
}

export interface CatalogFacets {
  /** Books the facets were built from — `visible && pages_count > 0`. */
  total: number;
  languages: FacetValue[];
  /**
   * Distinct languages after compounds are split and variants folded
   * ("Greek/Latin" is two, "Ancient Greek" is Greek) — see
   * `language-canonical.ts`. Always >= `languages.length`, which counts only
   * the labels that survive as a usable exact filter.
   *
   * Denominator note: this is over every visible processed book, NOT the
   * homepage's `languageCount`, which additionally requires translated pages
   * (`visibility-and-stats.md`). Same corpus, different question.
   */
  languageCount: number;
  categories: FacetValue[];
  collections: FacetValue[];
  providers: FacetValue[];
  /** Books per half-century, for the year-range histogram. */
  decades: { year: number; count: number }[];
  yearMin: number | null;
  yearMax: number | null;
  firstTranslations: number;
  translated: number;
  transcribed: number;
}

/**
 * Every facet on the catalogue, from ONE sweep of `books_catalog`.
 *
 * The page used to call `getLanguageCounts` (a full paginated sweep) and would
 * have needed `getCategoryCounts` (a second identical sweep) beside it, plus
 * one more per facet — the same ~29 round trips repeated per dimension, all
 * inside a 30s `maxDuration`. One sweep reads every facet column together and
 * counts them in JS.
 *
 * Pages are fetched concurrently after an exact count tells us how many there
 * are; sequential paging is what makes this shape slow, not the row volume.
 * Runs behind ISR (`revalidate = 86400`), so it costs this once a day.
 */
export async function getCatalogFacets(scope?: { collection?: string }): Promise<CatalogFacets> {
  const PAGE = 1000;
  const COLUMNS = 'language, categories, collections, year, image_source_provider, is_first_translation, pages_translated, pages_ocr';

  // PostgREST builders are chainable and structurally identical whatever their
  // row type, so the scope is applied through one generic helper rather than
  // repeated on the count query and every page query.
  type Chainable = {
    eq: (col: string, val: unknown) => Chainable;
    gt: (col: string, val: unknown) => Chainable;
    contains: (col: string, val: unknown) => Chainable;
  };
  const scoped = <T>(q: T): T => {
    let query = q as unknown as Chainable;
    query = query.eq('visible', true).gt('pages_count', 0);
    if (scope?.collection) query = query.contains('collections', [scope.collection]);
    return query as unknown as T;
  };

  const { count, error: countError } = await scoped(
    supabase.from('books_catalog').select('id', { count: 'exact', head: true }),
  );
  if (countError) throw new Error(`getCatalogFacets count failed: ${countError.message}`);

  const total = count || 0;
  const pageCount = Math.ceil(total / PAGE);
  const rows: Record<string, unknown>[] = [];

  // Bounded concurrency: enough to collapse the wall clock, few enough that we
  // aren't opening 30 sockets at once against Supabase.
  const CONCURRENCY = 8;
  for (let start = 0; start < pageCount; start += CONCURRENCY) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, pageCount - start) }, (_, i) => {
        const from = (start + i) * PAGE;
        return scoped(supabase.from('books_catalog').select(COLUMNS))
          // A deterministic total order is what makes the pages disjoint. Without
          // it Postgres may return rows in a different order per query, so
          // concurrent `.range()` windows overlap and skip — measured here as
          // facet counts that moved between identical page loads (languages read
          // 101, then 112, then 116 for the same corpus).
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1)
          .then(({ data, error }: { data: unknown; error: { message: string } | null }) => {
            if (error) throw new Error(`getCatalogFacets page failed: ${error.message}`);
            return (data || []) as Record<string, unknown>[];
          });
      }),
    );
    for (const page of batch) rows.push(...page);
  }

  const languages = new Map<string, number>();
  const categories = new Map<string, number>();
  const collections = new Map<string, number>();
  const providers = new Map<string, number>();
  const decades = new Map<number, number>();
  let yearMin: number | null = null;
  let yearMax: number | null = null;
  let firstTranslations = 0;
  let translated = 0;
  let transcribed = 0;

  const bump = (map: Map<string, number>, key: unknown) => {
    if (typeof key !== 'string' || !key.trim()) return;
    map.set(key, (map.get(key) || 0) + 1);
  };

  for (const row of rows) {
    bump(languages, row.language);
    bump(providers, row.image_source_provider);
    if (Array.isArray(row.categories)) for (const c of row.categories) bump(categories, canonicalizeCategory(String(c)));
    if (Array.isArray(row.collections)) for (const c of row.collections) bump(collections, String(c));

    const year = typeof row.year === 'number' ? row.year : null;
    // Years outside this window are catalogue errors, not books — they would
    // stretch the range slider across a millennium of empty space.
    if (year != null && year >= 1000 && year <= 1950) {
      if (yearMin == null || year < yearMin) yearMin = year;
      if (yearMax == null || year > yearMax) yearMax = year;
      const bucket = Math.floor(year / 50) * 50;
      decades.set(bucket, (decades.get(bucket) || 0) + 1);
    }

    // `is_first_translation` alone is a bibliographic claim set before the
    // translation exists (visibility-and-stats.md), so the count that sits
    // beside a "First translations" filter requires translated pages too — the
    // same gate the badge renders behind.
    if (row.is_first_translation === true && (row.pages_translated as number) > 0) firstTranslations++;
    if ((row.pages_translated as number) > 0) translated++;
    if ((row.pages_ocr as number) > 0) transcribed++;
  }

  const sorted = (map: Map<string, number>): FacetValue[] =>
    [...map.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);

  return {
    total,
    // Drop junk labels ("e") and multi-language "collab" labels: only a single
    // real language's raw label still matches the exact `eq('language', …)`
    // filter in browseBooks. See src/lib/language-canonical.ts.
    languages: sorted(languages).filter((l) => isSingleRealLanguage(l.value)),
    languageCount: distinctLanguageSet([...languages.keys()]).size,
    categories: sorted(categories),
    collections: sorted(collections),
    providers: sorted(providers),
    decades: [...decades.entries()].map(([year, count]) => ({ year, count })).sort((a, b) => a.year - b.year),
    yearMin,
    yearMax,
    firstTranslations,
    translated,
    transcribed,
  };
}

/**
 * Get category counts from books_catalog.
 * Unnests the categories array and counts occurrences.
 */
export async function getCategoryCounts(): Promise<Map<string, number>> {
  // Paginate — a bare select is capped at 1000 rows by Supabase, which
  // undercounted every category (philosophy showed 193 of 3,743) and dropped
  // whole categories whose books all sat past row 1000. Counts are keyed by
  // canonical form so casing variants fold into one bucket.
  const counts = new Map<string, number>();
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('books_catalog')
      .select('categories')
      .eq('visible', true)
      .gt('pages_count', 0)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`getCategoryCounts failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const row of data) {
      if (Array.isArray(row.categories)) {
        for (const cat of row.categories) {
          const key = canonicalizeCategory(cat);
          counts.set(key, (counts.get(key) || 0) + 1);
        }
      }
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return counts;
}

// All fields needed for the book detail page shell
const BOOK_DETAIL_SELECT = [
  BOOK_SELECT,
  'visible', // needed by the /book/[id] hidden-book gate (book-access.ts)
  'contributing_library',
  'summary_text',
  'publisher',
  'place_published',
  'doi',
  'work_id',
  'resource_type',
  'source_url',
  'provider_name',
  'image_attribution',
  'image_license',
  'cover_image',
  'dedication',
  'subtitle',
  'source_work_dates',
  'ft_disposition',
  'ft_reasoning',
  'description',
  'subject_keywords',
  'created_at',
  'updated_at',
].join(', ');

/**
 * Fetch a single book by slug or id from Supabase books_catalog.
 *
 * Used by /book/[id] for fast cold renders (<50ms vs 1-5s from Atlas).
 * Returns null if not found. Falls through to Atlas in the caller.
 *
 * Lookup order matches findBookByIdOrSlug: slug first, then id.
 */
export async function getBookDetail(idOrSlug: string): Promise<{ book: CatalogBookDetail; matchedBySlug: boolean } | null> {
  // Try slug first (the common case for SEO URLs)
  const { data: bySlug } = await supabase
    .from('books_catalog')
    .select(BOOK_DETAIL_SELECT)
    .eq('slug', idOrSlug)
    .limit(1)
    .maybeSingle();

  if (bySlug) {
    return { book: bySlug as unknown as CatalogBookDetail, matchedBySlug: true };
  }

  // Fall back to id
  const { data: byId } = await supabase
    .from('books_catalog')
    .select(BOOK_DETAIL_SELECT)
    .eq('id', idOrSlug)
    .limit(1)
    .maybeSingle();

  if (byId) {
    return { book: byId as unknown as CatalogBookDetail, matchedBySlug: false };
  }

  return null;
}

/**
 * Mirror a subset of changed book fields to Supabase books_catalog immediately.
 * Used by /api/books/[id] PATCH so cover/title/author edits surface in <1s
 * instead of waiting up to 5 min for the Hetzner sync cron.
 *
 * Only mirrors fields that exist in books_catalog. Silently no-ops if no
 * mirrored fields changed, or if supabaseAdmin is unavailable (e.g., local
 * dev without service-role key).
 */
const CATALOG_MIRROR_FIELDS = [
  'title', 'display_title', 'author', 'thumbnail', 'thumbnail_blob',
  'language', 'published', 'categories', 'publisher', 'place_published', 'doi',
] as const;

export async function mirrorBookToCatalog(
  bookId: string,
  updates: Record<string, unknown>,
): Promise<void> {
  if (!supabaseAdmin) return;

  const mirrored: Record<string, unknown> = {};
  for (const field of CATALOG_MIRROR_FIELDS) {
    if (field in updates) mirrored[field] = updates[field];
  }
  if (Object.keys(mirrored).length === 0) return;

  mirrored.updated_at = new Date().toISOString();

  const { error } = await supabaseAdmin
    .from('books_catalog')
    .update(mirrored)
    .eq('id', bookId);

  if (error) {
    // Non-fatal — the next cron sync will pick up the change.
    console.warn(`[books-catalog mirror] failed for ${bookId}:`, error.message);
  }
}
