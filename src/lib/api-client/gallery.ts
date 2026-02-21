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
  GalleryImageUpdateResponse,
  GalleryImageDetail
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
    if (params?.collection) queryParams.append('collection', params.collection);
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
    if (params?.includeArchive) queryParams.append('includeArchive', 'true');
    if (params?.maxPerBook) queryParams.append('maxPerBook', params.maxPerBook.toString());

    const query = queryParams.toString();
    return await apiClient.get(`/api/gallery${query ? `?${query}` : ''}`);
  },

  /**
   * Get a single gallery image by ID
   */
  get: async (id: string): Promise<GalleryImageDetail> => {
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
   * Find similar gallery images
   */
  similar: async (id: string, limit?: number): Promise<{
    items: GalleryItem[];
    total: number;
    method: string;
  }> => {
    const params = new URLSearchParams({ id });
    if (limit) params.append('limit', limit.toString());
    return await apiClient.get(`/api/gallery/similar?${params}`);
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

  /**
   * Collection operations
   */
  collections: {
    list: async (featured?: boolean): Promise<{
      collections: Array<{
        id: string;
        slug: string;
        title: string;
        description: string;
        imageCount: number;
        featured: boolean;
        coverImage: { url: string; description: string } | null;
      }>;
      total: number;
    }> => {
      const params = featured ? '?featured=true' : '';
      return await apiClient.get(`/api/gallery/collections${params}`);
    },

    get: async (slug: string): Promise<any> => {
      return await apiClient.get(`/api/gallery/collections/${slug}`);
    },

    create: async (data: {
      title: string;
      description: string;
      slug?: string;
      image_ids?: string[];
      cover_image_id?: string;
      featured?: boolean;
      sort_order?: number;
    }): Promise<any> => {
      return await apiClient.post('/api/gallery/collections', data);
    },

    update: async (slug: string, data: Record<string, unknown>): Promise<any> => {
      return await apiClient.patch(`/api/gallery/collections/${slug}`, data);
    },

    remove: async (slug: string): Promise<any> => {
      return await apiClient.post(`/api/gallery/collections/${slug}?action=delete`, {});
    },
  },
};
