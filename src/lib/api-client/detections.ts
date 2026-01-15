import { apiClient } from './client';
import type {
  Detection,
  DetectionsResponse,
  MarkReviewedRequest
} from './types/detections';

/**
 * Detections API client
 * Handles image detection operations
 */
export const detections = {
  /**
   * Get all detections
   */
  list: async (params?: { bookId?: string; pageId?: string; reviewed?: boolean }): Promise<DetectionsResponse> => {
    const queryParams = new URLSearchParams();
    if (params?.bookId) queryParams.append('bookId', params.bookId);
    if (params?.pageId) queryParams.append('pageId', params.pageId);
    if (params?.reviewed !== undefined) queryParams.append('reviewed', params.reviewed.toString());

    const query = queryParams.toString();
    return await apiClient.get(`/api/detections${query ? `?${query}` : ''}`);
  },

  /**
   * Mark detections as reviewed
   */
  markReviewed: async (detectionIds: string[], reviewed: boolean): Promise<{ success: boolean }> => {
    return await apiClient.post('/api/detections/mark-reviewed', { detectionIds, reviewed });
  },

  /**
   * Update a detection
   */
  update: async (id: string, updates: Partial<Detection>): Promise<Detection> => {
    return await apiClient.patch(`/api/detections/${id}`, updates);
  },

  /**
   * Create a detection
   */
  create: async (detection: Partial<Detection>): Promise<Detection> => {
    return await apiClient.post('/api/detections', detection);
  },

  /**
   * Delete a detection
   */
  delete: async (id: string): Promise<{ success: boolean }> => {
    return await apiClient.delete(`/api/detections/${id}`);
  },
};
