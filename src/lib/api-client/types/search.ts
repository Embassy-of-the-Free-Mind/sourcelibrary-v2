/**
 * Search API Types
 * Shared between API client and route handlers
 */

export interface SearchResult {
  id: string;
  page_id?: string;
  type: 'book' | 'page';
  book_id: string;
  slug?: string;
  title: string;
  display_title?: string;
  author: string;
  /** Editor name (compiler/editor of an edited volume). Used as the byline
   *  fallback when `author` is missing or "Unknown" — see src/lib/byline.ts. */
  editor?: string;
  language: string;
  published: string;
  page_count?: number;
  translated_count?: number;
  translation_percent?: number;
  has_doi: boolean;
  is_first_translation?: boolean;
  doi?: string;
  summary?: string;
  categories?: string[];
  page_number?: number;
  snippet?: string;
  snippet_type?: 'translation' | 'ocr' | 'summary';
  thumbnail?: string;
  thumbnail_blob?: string;
  image_display?: string;
  image_thumb?: string;
  quality_score?: number;
}

export interface SearchFilters {
  /**
   * TEXT language of the answer — an ISO code picking which edition of each
   * page to search and quote back (`page_texts.lang`). Distinct from
   * `language`, which filters by the BOOK's edition language. Anything but
   * `en` also narrows the request to books that HAVE that edition, so every
   * result is openable in it (#4095, invariants/search-filters-and-lanes.md).
   */
  lang?: string;
  language?: string;
  library?: string;
  date_from?: string;
  date_to?: string;
  has_doi?: string;
  has_translation?: string;
  first_translation?: string;
  category?: string;
  sort?: 'relevance' | 'date_asc' | 'date_desc' | 'title';
  offset?: number;
  limit?: number;
  search_content?: string;
}

export interface SearchResponse {
  query: string;
  /**
   * Size of this request's merged + deduped result window — NOT a stable
   * corpus-wide match count. When `partial` is true a search lane timed out or
   * errored, so this count is incomplete and should not be treated as
   * authoritative.
   */
  total: number;
  /** True when one or more search lanes degraded (timeout/error); `total` is then incomplete. */
  partial?: boolean;
  /** Which lanes degraded (e.g. 'page', 'book', 'semantic_book', 'semantic_page'). */
  degraded_lanes?: string[];
  offset: number;
  limit: number;
  sort: string;
  results: SearchResult[];
  filters: SearchFilters;
}

export interface IndexSearchResult {
  type: 'keyword' | 'concept' | 'person' | 'place' | 'vocabulary' | 'quote';
  term: string;
  book_id: string;
  book_slug?: string;
  book_title: string;
  book_author: string;
  pages?: number[];
  quote_text?: string;
  quote_page?: number;
  quote_significance?: string;
  section_title?: string;
}

export interface IndexSearchResponse {
  query: string;
  total: number;
  byType: {
    vocabulary: number;
    keyword: number;
    concept: number;
    person: number;
    place: number;
    quote: number;
  };
  results: IndexSearchResult[];
}

export interface UnifiedGalleryResult {
  id: string;
  imageUrl: string;
  description: string;
  type?: string;
  bookTitle: string;
  bookId: string;
}

export interface SemanticSearchResult {
  book_id: string;
  title: string;
  author: string | null;
  /** Editor name for edited volumes — falls back as byline when author missing. */
  editor?: string | null;
  language: string | null;
  year: number | null;
  summary_snippet: string;
  relevance_hint: string;
  similarity: number;
}

export interface UnifiedSearchResponse {
  query: string;
  books: {
    results: SearchResult[];
    total: number;
    hasMore?: boolean;
  };
  index: {
    results: IndexSearchResult[];
    total: number;
    hasMore?: boolean;
  };
  gallery?: {
    results: UnifiedGalleryResult[];
    total: number;
  };
  visual?: {
    results: UnifiedGalleryResult[];
    total: number;
  };
  semantic?: {
    results: SemanticSearchResult[];
    total: number;
  };
}
