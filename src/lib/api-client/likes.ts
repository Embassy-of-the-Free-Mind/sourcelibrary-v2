import { apiClient } from './client';
import type { LikeTargetType } from '@/lib/types';

// --- Batching layer for getStatus ---
// Collects individual targets over a 50ms window and fires one API call.
type PendingTarget = { type: LikeTargetType; id: string };
type BatchResolver = {
  targets: PendingTarget[];
  visitorId?: string;
  resolve: (value: Record<string, { count: number; liked: boolean }>) => void;
  reject: (err: unknown) => void;
};

let pendingBatch: BatchResolver[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;

function flushBatch() {
  const batch = pendingBatch;
  pendingBatch = [];
  batchTimer = null;

  if (batch.length === 0) return;

  // Merge all targets into one deduplicated set
  const allTargets = new Map<string, PendingTarget>();
  const visitorId = batch[0].visitorId; // All should share the same visitor
  for (const entry of batch) {
    for (const t of entry.targets) {
      allTargets.set(`${t.type}:${t.id}`, t);
    }
  }

  const targets = Array.from(allTargets.values());
  const params = new URLSearchParams();
  params.set('targets', JSON.stringify(targets));
  if (visitorId) params.set('visitor_id', visitorId);

  apiClient.get(`/api/likes?${params.toString()}`)
    .then((data: any) => {
      const results = data.results as Record<string, { count: number; liked: boolean }>;
      for (const entry of batch) {
        entry.resolve(results);
      }
    })
    .catch((err: unknown) => {
      for (const entry of batch) {
        entry.reject(err);
      }
    });
}

function batchGetStatus(
  targets: PendingTarget[],
  visitorId?: string
): Promise<Record<string, { count: number; liked: boolean }>> {
  return new Promise((resolve, reject) => {
    pendingBatch.push({ targets, visitorId, resolve, reject });
    if (!batchTimer) {
      batchTimer = setTimeout(flushBatch, 50);
    }
  });
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
    return await apiClient.post('/api/likes', {
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
    const queryParams = new URLSearchParams();
    queryParams.append('type', params.type);
    if (params.limit) queryParams.append('limit', params.limit.toString());
    if (params.min_likes) queryParams.append('min_likes', params.min_likes.toString());

    return await apiClient.get(`/api/likes/popular?${queryParams.toString()}`);
  },

  /**
   * Get all likes for a visitor, optionally filtered by type
   */
  getMine: async <T = unknown>(params: {
    type?: LikeTargetType;
    visitorId: string;
  }): Promise<{ items: T[] }> => {
    const queryParams = new URLSearchParams();
    queryParams.append('visitor_id', params.visitorId);
    if (params.type) queryParams.append('type', params.type);
    return await apiClient.get(`/api/likes/mine?${queryParams.toString()}`);
  },

  /**
   * Get like status for multiple targets — auto-batched.
   * Individual calls within a 50ms window are merged into one API request.
   */
  getStatus: async (targetsKey: string, visitorId?: string): Promise<{
    results: Record<string, { count: number; liked: boolean }>
  }> => {
    const targets: PendingTarget[] = JSON.parse(targetsKey);
    const results = await batchGetStatus(targets, visitorId);
    return { results };
  },
};
