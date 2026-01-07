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
};
