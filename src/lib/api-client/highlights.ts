import { apiClient } from './client';
import type {
  Highlight,
  HighlightCreateRequest,
  HighlightUpdateRequest,
  HighlightListParams,
  HighlightListResponse
} from './types/highlights';

/**
 * Highlights API client
 * Handles user highlights and annotations
 */
/**
 * Highlights API client
 * Handles user highlights and annotations
 */
export const highlights = {
  /**
   * Get all highlights with filters
   */
  list: async (params?: HighlightListParams): Promise<HighlightListResponse> => {
    const queryParams = new URLSearchParams();
    if (params?.book_id) queryParams.append('book_id', params.book_id);
    if (params?.page_id) queryParams.append('page_id', params.page_id);
    if (params?.user_id) queryParams.append('user_id', params.user_id);
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.offset) queryParams.append('offset', params.offset.toString());

    const query = queryParams.toString();
    return await apiClient.get(`/api/highlights${query ? `?${query}` : ''}`);
  },

  /**
   * Get a single highlight by ID
   */
  get: async (id: string): Promise<Highlight> => {
    return await apiClient.get(`/api/highlights/${id}`);
  },

  /**
   * Create a new highlight
   */
  create: async (highlight: HighlightCreateRequest): Promise<Highlight> => {
    return await apiClient.post('/api/highlights', highlight);
  },

  /**
   * Update a highlight
   */
  update: async (id: string, updates: HighlightUpdateRequest): Promise<Highlight> => {
    return await apiClient.patch(`/api/highlights/${id}`, updates);
  },

  /**
   * Delete a highlight
   */
  delete: async (id: string): Promise<{ success: boolean }> => {
    return await apiClient.delete(`/api/highlights/${id}`);
  },

  /**
   * Get highlights for a specific page
   */
  forPage: async (pageId: string): Promise<{ highlights: Highlight[] }> => {
    return await apiClient.get(`/api/highlights/page/${pageId}`);
  },

  /**
   * Get highlights for a specific book
   */
  forBook: async (bookId: string): Promise<{ highlights: Highlight[] }> => {
    return await apiClient.get(`/api/highlights/book/${bookId}`);
  },

  /**
   * Get current user's highlights
   */
  mine: async (): Promise<{ highlights: Highlight[] }> => {
    return await apiClient.get('/api/highlights/mine');
  },
};
