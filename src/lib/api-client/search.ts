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
    if (filters?.date_from) params.append('date_from', filters.date_from);
    if (filters?.date_to) params.append('date_to', filters.date_to);
    if (filters?.has_doi) params.append('has_doi', filters.has_doi);
    if (filters?.has_translation) params.append('has_translation', filters.has_translation);
    if (filters?.category) params.append('category', filters.category);

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
};
