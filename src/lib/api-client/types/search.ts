/**
 * Search API Types
 * Shared between API client and route handlers
 */

export interface SearchResult {
  id: string;
  type: 'book' | 'page';
  book_id: string;
  title: string;
  display_title?: string;
  author: string;
  language: string;
  published: string;
  page_count?: number;
  translated_count?: number;
  has_doi: boolean;
  doi?: string;
  summary?: string;
  categories?: string[];
  page_number?: number;
  snippet?: string;
  snippet_type?: 'translation' | 'ocr' | 'summary';
}

export interface SearchFilters {
  language?: string;
  date_from?: string;
  date_to?: string;
  has_doi?: string;
  has_translation?: string;
  category?: string;
}

export interface SearchResponse {
  query: string;
  total: number;
  results: SearchResult[];
  filters: SearchFilters;
}

export interface IndexSearchResult {
  type: 'keyword' | 'concept' | 'person' | 'place' | 'vocabulary' | 'quote';
  term: string;
  book_id: string;
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

export interface UnifiedSearchResponse {
  query: string;
  books: SearchResult[];
  pages: SearchResult[];
  index: IndexSearchResult[];
  total: number;
}
