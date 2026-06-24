import { apiClient } from './client';
import type { LikeTargetType } from '@/lib/types';

/**
 * Views API client — durable first-party view counters (see /api/views).
 *
 * `record` is fire-and-forget via sendBeacon so it never blocks navigation
 * and survives the page unloading mid-request (same pattern as
 * reading-history). Server handles bot filtering and dedup.
 */
export const views = {
  record: (targetType: LikeTargetType, targetId: string) => {
    if (typeof navigator === 'undefined' || !navigator.sendBeacon) return;
    const payload = JSON.stringify({ target_type: targetType, target_id: targetId });
    navigator.sendBeacon('/api/views', new Blob([payload], { type: 'application/json' }));
  },

  /**
   * Batch view counts: { results: { "image:abc-0": { count: 12 } } }
   */
  getCounts: async (
    targets: Array<{ type: LikeTargetType; id: string }>
  ): Promise<{ results: Record<string, { count: number }> }> => {
    return await apiClient.get(`/api/views?targets=${encodeURIComponent(JSON.stringify(targets))}`);
  },
};
