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
  // Fetch just the author column for books matching this letter with translations
  const { data, error } = await supabase
    .from('books_catalog')
    .select('author')
    .eq('visible', true)
    .gt('pages_count', 0)
    .gt('pages_translated', 0)
    .ilike('author', `${letter}%`);

  if (error) throw new Error(`browseAuthors query failed: ${error.message}`);

  // Group by author and count
  const counts = new Map<string, number>();
  for (const row of (data || [])) {
    if (row.author) counts.set(row.author, (counts.get(row.author) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
