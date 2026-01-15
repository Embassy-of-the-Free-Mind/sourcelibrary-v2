import { apiClient } from './client';
import type { Annotation, AnnotationType, AnnotationStatus, EncyclopediaEntry, EncyclopediaEntryType, TermLink } from '@/lib/types';
import type {
  AnnotationCreateRequest,
  AnnotationUpdateRequest,
  AnnotationListParams,
  AnnotationListResponse,
  AnnotationUpvoteResponse,
  EncyclopediaEntryCreateRequest,
  EncyclopediaEntryUpdateRequest,
  EncyclopediaListParams,
  EncyclopediaListResponse
} from './types/annotations';

/**
 * Annotations API client
 * Handles community annotations and encyclopedia entries
 */
/**
 * Annotations API client
 * Handles community annotations and encyclopedia entries
 */
export const annotations = {
  /**
   * Get all annotations with filters
   */
  list: async (params?: AnnotationListParams): Promise<AnnotationListResponse> => {
    const queryParams = new URLSearchParams();
    if (params?.book_id) queryParams.append('book_id', params.book_id);
    if (params?.page_id) queryParams.append('page_id', params.page_id);
    if (params?.user_id) queryParams.append('user_id', params.user_id);
    if (params?.type) queryParams.append('type', params.type);
    if (params?.status) queryParams.append('status', params.status);
    if (params?.parent_id !== undefined) queryParams.append('parent_id', params.parent_id || '');
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.offset) queryParams.append('offset', params.offset.toString());

    const query = queryParams.toString();
    return await apiClient.get(`/api/annotations${query ? `?${query}` : ''}`);
  },

  /**
   * Get a single annotation by ID
   */
  get: async (id: string): Promise<Annotation> => {
    return await apiClient.get(`/api/annotations/${id}`);
  },

  /**
   * Create a new annotation
   */
  create: async (annotation: AnnotationCreateRequest): Promise<Annotation> => {
    return await apiClient.post('/api/annotations', annotation);
  },

  /**
   * Update an annotation
   */
  update: async (id: string, updates: AnnotationUpdateRequest): Promise<Annotation> => {
    return await apiClient.patch(`/api/annotations/${id}`, updates);
  },

  /**
   * Delete an annotation
   */
  delete: async (id: string): Promise<{ success: boolean }> => {
    return await apiClient.delete(`/api/annotations/${id}`);
  },

  /**
   * Upvote an annotation
   */
  upvote: async (id: string): Promise<AnnotationUpvoteResponse> => {
    return await apiClient.post(`/api/annotations/${id}/upvote`);
  },

  /**
   * Get replies to an annotation
   */
  replies: async (id: string): Promise<{ replies: Annotation[] }> => {
    return await apiClient.get(`/api/annotations/${id}/replies`);
  },
};

/**
 * Encyclopedia API client
 * Handles encyclopedia entries for terms, people, places, etc.
 */
export const encyclopedia = {
  /**
   * Get all encyclopedia entries with filters
   */
  list: async (params?: EncyclopediaListParams): Promise<EncyclopediaListResponse> => {
    const queryParams = new URLSearchParams();
    if (params?.type) queryParams.append('type', params.type);
    if (params?.category) queryParams.append('category', params.category);
    if (params?.search) queryParams.append('search', params.search);
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.offset) queryParams.append('offset', params.offset.toString());

    const query = queryParams.toString();
    return await apiClient.get(`/api/encyclopedia${query ? `?${query}` : ''}`);
  },

  /**
   * Get an encyclopedia entry by ID
   */
  get: async (id: string): Promise<EncyclopediaEntry> => {
    return await apiClient.get(`/api/encyclopedia/${id}`);
  },

  /**
   * Get an encyclopedia entry by slug
   */
  getBySlug: async (slug: string): Promise<EncyclopediaEntry> => {
    return await apiClient.get(`/api/encyclopedia/slug/${slug}`);
  },

  /**
   * Create a new encyclopedia entry
   */
  create: async (entry: EncyclopediaEntryCreateRequest): Promise<EncyclopediaEntry> => {
    return await apiClient.post('/api/encyclopedia', entry);
  },

  /**
   * Update an encyclopedia entry
   */
  update: async (id: string, updates: EncyclopediaEntryUpdateRequest): Promise<EncyclopediaEntry> => {
    return await apiClient.patch(`/api/encyclopedia/${id}`, updates);
  },

  /**
   * Delete an encyclopedia entry
   */
  delete: async (id: string): Promise<{ success: boolean }> => {
    return await apiClient.delete(`/api/encyclopedia/${id}`);
  },

  /**
   * Search encyclopedia entries
   */
  search: async (query: string): Promise<{ entries: EncyclopediaEntry[] }> => {
    return await apiClient.get(`/api/encyclopedia/search?q=${encodeURIComponent(query)}`);
  },
};

/**
 * Term Links API client
 * Handles auto-extracted links from book text to encyclopedia entries
 */
export const termLinks = {
  /**
   * Get term links for a page
   */
  forPage: async (pageId: string): Promise<{ links: TermLink[] }> => {
    return await apiClient.get(`/api/term-links/page/${pageId}`);
  },

  /**
   * Get term links for a book
   */
  forBook: async (bookId: string): Promise<{ links: TermLink[] }> => {
    return await apiClient.get(`/api/term-links/book/${bookId}`);
  },

  /**
   * Confirm or reject a term link
   */
  confirm: async (id: string, confirmed: boolean): Promise<TermLink> => {
    return await apiClient.post(`/api/term-links/${id}/confirm`, { confirmed });
  },

  /**
   * Extract term links from a book
   */
  extract: async (bookId: string): Promise<{ extracted: number; links: TermLink[] }> => {
    return await apiClient.post(`/api/term-links/extract`, { book_id: bookId });
  },
};
