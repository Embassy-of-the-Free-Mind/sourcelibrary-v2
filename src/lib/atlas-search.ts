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

interface SearchOptions {
  /** Use autocomplete for prefix matching (dropdown) vs text for full-word matching (search page) */
  autocomplete?: boolean;
  /** Enable fuzzy matching for typo tolerance */
  fuzzy?: boolean;
}

/**
 * Build a $search aggregation stage for the books collection.
 * Searches title, display_title, author, reading_summary.overview with boosting.
 * Filters on indexed fields (hidden, language, categories, year, is_first_translation, pages_translated).
 *
 * Options:
 * - autocomplete: use prefix matching (for dropdown typeahead)
 * - fuzzy: tolerate typos (maxEdits: 1)
 */
export function buildBookSearchStage(query: string, filters: BookSearchFilters = {}, options: SearchOptions = {}): Document {
  const fuzzyOpt = options.fuzzy ? { fuzzy: { maxEdits: 1, prefixLength: 2 } } : {};

  const should: Document[] = options.autocomplete
    ? [
        // Autocomplete for prefix matching on title/author
        { autocomplete: { query, path: 'title', score: { boost: { value: 10 } }, ...fuzzyOpt } },
        { autocomplete: { query, path: 'display_title', score: { boost: { value: 10 } }, ...fuzzyOpt } },
        { autocomplete: { query, path: 'author', score: { boost: { value: 5 } }, ...fuzzyOpt } },
        // Also include text match on overview (no autocomplete index on this field)
        { text: { query, path: 'reading_summary.overview' } },
      ]
    : [
        { text: { query, path: 'title', score: { boost: { value: 10 } }, ...fuzzyOpt } },
        { text: { query, path: 'display_title', score: { boost: { value: 10 } }, ...fuzzyOpt } },
        { text: { query, path: 'author', score: { boost: { value: 5 } }, ...fuzzyOpt } },
        { text: { query, path: 'reading_summary.overview', ...fuzzyOpt } },
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
      highlight: {
        path: ['translation.data', 'ocr.data'],
        maxCharsToExamine: 100000,
        maxNumPassages: 2,
      },
    },
  };
}
