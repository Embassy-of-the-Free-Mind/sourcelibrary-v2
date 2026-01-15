import { apiClient } from './client';
import type { LikeTargetType } from '@/lib/types';

/**
 * Likes API client
 * Handles liking/unliking content (books, pages, images)
 */
export const likes = {
  /**
   * Toggle like on a target (like if not liked, unlike if already liked)
   */
  toggle: async (targetType: LikeTargetType, targetId: string, visitorId: string): Promise<{ success: boolean; liked: boolean; count: number }> => {
    return await apiClient.post('/api/likes', {
      target_type: targetType,
      target_id: targetId,
      visitor_id: visitorId,
    });
  },

  /**
   * Get like count for a target
   */
  getCount: async (targetType: LikeTargetType, targetId: string): Promise<{ count: number }> => {
    return await apiClient.get(`/api/likes/count?target_type=${targetType}&target_id=${targetId}`);
  },

  /**
   * Get popular items (most liked)
   */
  getPopular: async <T = unknown>(params: {
    type: LikeTargetType;
    limit?: number;
    min_likes?: number;
  }): Promise<{ items: T[] }> => {
    const queryParams = new URLSearchParams();
    queryParams.append('type', params.type);
    if (params.limit) queryParams.append('limit', params.limit.toString());
    if (params.min_likes) queryParams.append('min_likes', params.min_likes.toString());

    return await apiClient.get(`/api/likes/popular?${queryParams.toString()}`);
  },

  /**
   * Get like status for multiple targets (batch)
   */
  getStatus: async (targetsKey: string, visitorId?: string): Promise<{
    results: Record<string, { count: number; liked: boolean }>
  }> => {
    const params = new URLSearchParams();
    params.set('targets', targetsKey);
    if (visitorId) {
      params.set('visitor_id', visitorId);
    }
    return await apiClient.get(`/api/likes?${params.toString()}`);
  },
};
