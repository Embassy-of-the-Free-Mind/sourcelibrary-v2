import { apiClient } from './client';
import type {
  BBox,
  ImageMetadata,
  GalleryItem,
  BookInfo,
  GalleryFilters,
  GalleryResponse,
  GallerySearchParams,
  GalleryImageUpdateRequest,
  GalleryImageUpdateResponse
} from './types/gallery';

/**
 * Gallery API client
 * Handles image gallery and extraction operations
 */
export const gallery = {
  /**
   * Get gallery items with filters
   */
  list: async (params?: GallerySearchParams): Promise<GalleryResponse> => {
    const queryParams = new URLSearchParams();
    if (params?.bookId) queryParams.append('bookId', params.bookId);
    if (params?.query) queryParams.append('q', params.query);
    if (params?.type) queryParams.append('type', params.type);
    if (params?.subject) queryParams.append('subject', params.subject);
    if (params?.figure) queryParams.append('figure', params.figure);
    if (params?.symbol) queryParams.append('symbol', params.symbol);
    if (params?.yearFrom) queryParams.append('yearFrom', params.yearFrom.toString());
    if (params?.yearTo) queryParams.append('yearTo', params.yearTo.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.offset) queryParams.append('offset', params.offset.toString());
    if (params?.minQuality) queryParams.append('minQuality', params.minQuality.toString());

    const query = queryParams.toString();
    return await apiClient.get(`/api/gallery${query ? `?${query}` : ''}`);
  },

  /**
   * Get a single gallery image by ID
   */
  get: async (id: string): Promise<GalleryItem> => {
    return await apiClient.get(`/api/gallery/image/${id}`);
  },

  /**
   * Update gallery image metadata
   */
  update: async (id: string, updates: GalleryImageUpdateRequest): Promise<GalleryImageUpdateResponse> => {
    return await apiClient.patch(`/api/gallery/image/${id}`, updates);
  },

  /**
   * Delete gallery image
   */
  delete: async (id: string): Promise<{ success: boolean }> => {
    return await apiClient.delete(`/api/gallery/image/${id}`);
  },

  /**
   * Extract images from a book
   */
  extractImages: async (bookId: string): Promise<{ job_id: string; message: string }> => {
    return await apiClient.post('/api/extract-images', { book_id: bookId });
  },

  /**
   * Get gallery statistics
   */
  stats: async (): Promise<{
    total_images: number;
    by_type: Record<string, number>;
    by_book: Array<{ book_id: string; book_title: string; count: number }>;
  }> => {
    return await apiClient.get('/api/gallery/stats');
  },
};
