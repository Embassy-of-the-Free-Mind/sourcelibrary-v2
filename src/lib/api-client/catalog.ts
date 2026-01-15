import { apiClient } from './client';
import type {
  CatalogResult,
  CatalogSearchResponse,
  CatalogImportRequest,
  CatalogImportResponse
} from './types/catalog';

/**
 * Catalog API client
 * Handles searching and importing from external catalogs
 */
export const catalog = {
  /**
   * Search external catalogs (Internet Archive, Gallica, MDZ, etc.)
   */
  search: async (query: string, options?: { limit?: number; source?: string }): Promise<CatalogSearchResponse> => {
    const params = new URLSearchParams({ q: query });
    if (options?.limit) params.append('limit', options.limit.toString());
    if (options?.source) params.append('source', options.source);

    return await apiClient.get(`/api/catalog/search?${params}`);
  },

  /**
   * Search USTC catalog (includes EFM, IA, and USTC enrichments)
   */
  ustcSearch: async (query: string): Promise<{ results: Array<{
    id: string;
    title: string;
    englishTitle?: string;
    author?: string;
    language?: string;
    year?: string;
    place?: string;
    source?: string;
    workType?: string;
    subjectTags?: string[];
  }> }> => {
    const params = new URLSearchParams({ q: query });
    return await apiClient.get(`/api/ustc/search?${params}`);
  },

  /**
   * Get catalog entry by ID
   */
  get: async (id: string): Promise<CatalogResult> => {
    return await apiClient.get(`/api/catalog/${id}`);
  },

  /**
   * Import a book from external catalog
   */
  import: async (request: CatalogImportRequest): Promise<CatalogImportResponse> => {
    return await apiClient.post('/api/catalog/import', request);
  },
};
