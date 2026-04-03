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
  quality_score?: number;
}

export interface SearchFilters {
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
  total: number;
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
}
