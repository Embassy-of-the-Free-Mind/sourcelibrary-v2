import type { Document } from 'mongodb';

export const BOOK_SEARCH_INDEX = 'books_search';
export const PAGE_SEARCH_INDEX = 'pages_search';

export interface BookSearchFilters {
  language?: string;
  category?: string;
  yearExact?: number;
  yearFrom?: number;
  yearTo?: number;
  isFirstTranslation?: boolean;
  hasTranslation?: boolean;
}

/**
 * Build a $search aggregation stage for the books collection.
 * Searches title, display_title, author, reading_summary.overview with boosting.
 * Filters on indexed fields (hidden, language, categories, year, is_first_translation, pages_translated).
 */
export function buildBookSearchStage(query: string, filters: BookSearchFilters = {}): Document {
  const should: Document[] = [
    { text: { query, path: 'title', score: { boost: { value: 10 } } } },
    { text: { query, path: 'display_title', score: { boost: { value: 10 } } } },
    { text: { query, path: 'author', score: { boost: { value: 5 } } } },
    { text: { query, path: 'reading_summary.overview' } },
  ];

  const filter: Document[] = [];
  const mustNot: Document[] = [
    { equals: { path: 'hidden', value: true } },
  ];

  // Exclude empty shell books (0 pages from failed imports)
  filter.push({ range: { path: 'pages_count', gt: 0 } });

  if (filters.language) {
    filter.push({ equals: { path: 'language', value: filters.language } });
  }
  if (filters.category) {
    filter.push({ equals: { path: 'categories', value: filters.category } });
  }
  if (filters.isFirstTranslation) {
    filter.push({ equals: { path: 'is_first_translation', value: true } });
  }
  if (filters.hasTranslation) {
    filter.push({ range: { path: 'pages_translated', gt: 0 } });
  }
  if (filters.yearExact !== undefined) {
    filter.push({ equals: { path: 'year', value: filters.yearExact } });
  } else if (filters.yearFrom !== undefined || filters.yearTo !== undefined) {
    const yearRange: Document = { path: 'year' };
    if (filters.yearFrom !== undefined) yearRange.gte = filters.yearFrom;
    if (filters.yearTo !== undefined) yearRange.lte = filters.yearTo;
    filter.push({ range: yearRange });
  }

  return {
    $search: {
      index: BOOK_SEARCH_INDEX,
      compound: {
        should,
        minimumShouldMatch: 1,
        ...(filter.length > 0 && { filter }),
        mustNot,
      },
    },
  };
}

/**
 * Build a $search aggregation stage for the pages collection.
 * Searches translation.data (boosted 2x) and ocr.data.
 * Optionally filters by book_id (single or array via $in).
 */
export function buildPageSearchStage(query: string, bookIds?: string | string[]): Document {
  const should: Document[] = [
    { text: { query, path: 'translation.data', score: { boost: { value: 2 } } } },
    { text: { query, path: 'ocr.data' } },
  ];

  const filter: Document[] = [];
  if (bookIds) {
    if (typeof bookIds === 'string') {
      filter.push({ equals: { path: 'book_id', value: bookIds } });
    } else if (bookIds.length > 0) {
      filter.push({ in: { path: 'book_id', value: bookIds } });
    }
  }

  return {
    $search: {
      index: PAGE_SEARCH_INDEX,
      compound: {
        should,
        minimumShouldMatch: 1,
        ...(filter.length > 0 && { filter }),
      },
    },
  };
}
