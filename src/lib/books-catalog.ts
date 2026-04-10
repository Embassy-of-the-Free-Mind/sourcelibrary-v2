/**
 * Supabase books_catalog query helpers.
 *
 * Shared data layer for browse/language/library pages that read from
 * the Supabase books_catalog mirror instead of MongoDB.
 *
 * The books_catalog table is synced from MongoDB every 5 minutes
 * via the Hetzner supabase-sync cron.
 */

import { supabase } from '@/lib/supabase';

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
}

/** Extended book detail from Supabase — includes fields for the /book/[id] page shell. */
export interface CatalogBookDetail extends CatalogBook {
  contributing_library: string | null;
  summary_text: string | null;
  publisher: string | null;
  place_published: string | null;
  doi: string | null;
  work_id: string | null;
  resource_type: string | null;
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
  description: string | null;
  subject_keywords: string[] | null;
  created_at: string | null;
  updated_at: string | null;
}

const BOOK_SELECT = 'id, slug, title, display_title, author, year, language, published, pages_count, pages_ocr, pages_translated, pages_blank, photo, thumbnail, thumbnail_blob, read_count, is_first_translation, quality_score, image_source_provider, categories, collections';

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
  firstTranslation?: boolean;
  hasTranslation?: boolean;
  hasPages?: boolean;
  yearMin?: number;
  yearMax?: number;
  titlePrefix?: string;
  authorPrefix?: string;
  search?: string;
  sort?: SortOption;
  offset?: number;
  limit?: number;
}): Promise<{ books: CatalogBook[]; total: number }> {
  const limit = opts.limit || 60;
  const offset = opts.offset || 0;

  let query = supabase
    .from('books_catalog')
    .select(BOOK_SELECT, { count: 'exact' })
    .eq('visible', true);

  if (opts.hasPages !== false) query = query.gt('pages_count', 0);
  if (opts.hasTranslation) query = query.gt('pages_translated', 0);
  if (opts.language) query = query.eq('language', opts.language);
  if (opts.collection) query = query.contains('collections', [opts.collection]);
  if (opts.category) query = query.contains('categories', [opts.category]);
  if (opts.provider) query = query.eq('image_source_provider', opts.provider);
  if (opts.firstTranslation) query = query.eq('is_first_translation', true);
  if (opts.yearMin != null) query = query.gte('year', opts.yearMin);
  if (opts.yearMax != null) query = query.lte('year', opts.yearMax);
  if (opts.titlePrefix) query = query.or(`display_title.ilike.${opts.titlePrefix}%,title.ilike.${opts.titlePrefix}%`);
  if (opts.authorPrefix) query = query.ilike('author', `${opts.authorPrefix}%`);
  if (opts.search) query = query.or(`title.ilike.%${opts.search}%,display_title.ilike.%${opts.search}%,author.ilike.%${opts.search}%`);

  query = applySort(query, opts.sort || 'popular');
  query = query.range(offset, offset + limit - 1);

  const { data, count, error } = await query;
  if (error) throw new Error(`books_catalog query failed: ${error.message}`);

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
export async function getLanguageCounts(filter: {
  provider?: string;
  collection?: string;
}): Promise<{ lang: string; count: number }[]> {
  let query = supabase
    .from('books_catalog')
    .select('language')
    .eq('visible', true)
    .gt('pages_count', 0);

  if (filter.provider) query = query.eq('image_source_provider', filter.provider);
  if (filter.collection) query = query.contains('collections', [filter.collection]);

  const { data } = await query;
  const counts = new Map<string, number>();
  for (const row of (data || [])) {
    if (row.language) counts.set(row.language, (counts.get(row.language) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([lang, count]) => ({ lang, count }))
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

  let query = supabase
    .from('books_catalog')
    .select('id')
    .gt('pages_count', 0)
    .or(`title.ilike.%${text}%,display_title.ilike.%${text}%,author.ilike.%${text}%`)
    .limit(limit);

  if (!opts?.includeHidden) query = query.eq('visible', true);

  const { data, error } = await query;
  if (error) throw new Error(`searchBookIds failed: ${error.message}`);
  return (data || []).map(row => row.id);
}

/**
 * Get category counts from books_catalog.
 * Unnests the categories array and counts occurrences.
 */
export async function getCategoryCounts(): Promise<Map<string, number>> {
  const { data } = await supabase
    .from('books_catalog')
    .select('categories')
    .eq('visible', true)
    .gt('pages_count', 0);

  const counts = new Map<string, number>();
  for (const row of (data || [])) {
    if (Array.isArray(row.categories)) {
      for (const cat of row.categories) {
        counts.set(cat, (counts.get(cat) || 0) + 1);
      }
    }
  }
  return counts;
}

// All fields needed for the book detail page shell
const BOOK_DETAIL_SELECT = [
  BOOK_SELECT,
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
