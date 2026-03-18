import { apiClient } from './client';
import type { SearchResult, SearchFilters, SearchResponse, IndexSearchResult, IndexSearchResponse, UnifiedSearchResponse } from './types/search';

/**
 * Search API client
 * Handles full-text search across books, pages, and indexes
 */
export const search = {
  /**
   * Search across all content (books and pages)
   */
  search: async (query: string, filters?: SearchFilters): Promise<SearchResponse> => {
    const params = new URLSearchParams({ q: query });
    if (filters?.language) params.append('language', filters.language);
    if (filters?.library) params.append('library', filters.library);
    if (filters?.date_from) params.append('date_from', filters.date_from);
    if (filters?.date_to) params.append('date_to', filters.date_to);
    if (filters?.has_doi) params.append('has_doi', filters.has_doi);
    if (filters?.has_translation) params.append('has_translation', filters.has_translation);
    if (filters?.first_translation) params.append('first_translation', filters.first_translation);
    if (filters?.category) params.append('category', filters.category);
    if (filters?.sort) params.append('sort', filters.sort);
    if (filters?.offset) params.append('offset', filters.offset.toString());
    if (filters?.limit) params.append('limit', filters.limit.toString());
    if (filters?.search_content) params.append('search_content', filters.search_content);

    return await apiClient.get(`/api/search?${params}`);
  },

  /**
   * Search book indexes (keywords, concepts, people, places, quotes)
   */
  index: async (query: string, options?: { type?: string; bookId?: string }): Promise<IndexSearchResponse> => {
    const params = new URLSearchParams({ q: query });
    if (options?.type) params.append('type', options.type);
    if (options?.bookId) params.append('book_id', options.bookId);

    return await apiClient.get(`/api/search/index?${params}`);
  },

  /**
   * Unified search (books + pages + indexes in one request)
   */
  unified: async (query: string, options?: { limit?: number; filters?: SearchFilters }): Promise<UnifiedSearchResponse> => {
    const params = new URLSearchParams({ q: query });
    if (options?.limit) params.append('limit', options.limit.toString());
    if (options?.filters?.language) params.append('language', options.filters.language);
    if (options?.filters?.date_from) params.append('date_from', options.filters.date_from);
    if (options?.filters?.date_to) params.append('date_to', options.filters.date_to);
    if (options?.filters?.has_doi) params.append('has_doi', options.filters.has_doi);
    if (options?.filters?.has_translation) params.append('has_translation', options.filters.has_translation);
    if (options?.filters?.category) params.append('category', options.filters.category);

    return await apiClient.get(`/api/search/unified?${params}`);
  },

  /**
   * Get search suggestions/autocomplete
   */
  suggest: async (query: string): Promise<{ suggestions: string[] }> => {
    return await apiClient.get(`/api/search/suggest?q=${encodeURIComponent(query)}`);
  },

  /**
   * AI-powered query expansion for zero-result searches
   */
  aiExpand: async (query: string): Promise<{ original: string; terms: string[]; note: string }> => {
    return await apiClient.post('/api/search/ai-expand', { query });
  },

  /**
   * Browse books (no query required) via /api/books/library
   */
  browse: async (params?: {
    language?: string;
    category?: string;
    collection?: string;
    sort?: string;
    limit?: number;
    skip?: number;
    search?: string;
    library?: string;
    first_translation?: boolean;
  }): Promise<{ books: any[]; total: number }> => {
    const qs = new URLSearchParams();
    if (params?.language) qs.set('language', params.language);
    if (params?.category) qs.set('category', params.category);
    if (params?.collection) qs.set('collection', params.collection);
    if (params?.sort) qs.set('sort', params.sort);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.skip) qs.set('skip', String(params.skip));
    if (params?.search) qs.set('search', params.search);
    if (params?.library) qs.set('library', params.library);
    if (params?.first_translation) qs.set('first_translation', 'true');
    return await apiClient.get(`/api/books/library?${qs}`);
  },
};
