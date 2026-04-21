import { apiClient } from './client';
import type { LikeTargetType } from '@/lib/types';

function getTenantSlug(): string {
  if (typeof window === 'undefined') return '';
  const slug = window.location.pathname.split('/')[1] || '';
  return /^[a-z0-9-]+$/.test(slug) ? slug : '';
}

/**
 * Likes API client
 * Handles liking/unliking content (books, pages, images)
 */
export const likes = {
  /**
   * Toggle like on a target (like if not liked, unlike if already liked)
   */
  toggle: async (targetType: LikeTargetType, targetId: string, visitorId: string): Promise<{ success: boolean; liked: boolean; count: number; cascade?: { book_id: string; book_liked: boolean; book_count: number } }> => {
    const tenant = getTenantSlug();
    return await apiClient.post(`/api/${tenant}/likes`, {
      target_type: targetType,
      target_id: targetId,
      visitor_id: visitorId,
    });
  },

  /**
   * Get popular items (most liked)
   */
  getPopular: async <T = unknown>(params: {
    type: LikeTargetType;
    limit?: number;
    min_likes?: number;
  }): Promise<{ items: T[] }> => {
    const tenant = getTenantSlug();
    const queryParams = new URLSearchParams();
    queryParams.append('type', params.type);
    if (params.limit) queryParams.append('limit', params.limit.toString());
    if (params.min_likes) queryParams.append('min_likes', params.min_likes.toString());

    return await apiClient.get(`/api/${tenant}/likes/popular?${queryParams.toString()}`);
  },

  /**
   * Get all likes for a visitor, optionally filtered by type
   */
  getMine: async <T = unknown>(params: {
    type?: LikeTargetType;
    visitorId: string;
  }): Promise<{ items: T[] }> => {
    const tenant = getTenantSlug();
    const queryParams = new URLSearchParams();
    queryParams.append('visitor_id', params.visitorId);
    if (params.type) queryParams.append('type', params.type);
    return await apiClient.get(`/api/${tenant}/likes/mine?${queryParams.toString()}`);
  },

  /**
   * Get like status for multiple targets (batch)
   */
  getStatus: async (targetsKey: string, visitorId?: string): Promise<{
    results: Record<string, { count: number; liked: boolean }>
  }> => {
    const tenant = getTenantSlug();
    const params = new URLSearchParams();
    params.set('targets', targetsKey);
    if (visitorId) {
      params.set('visitor_id', visitorId);
    }
    return await apiClient.get(`/api/${tenant}/likes?${params.toString()}`);
  },
};
