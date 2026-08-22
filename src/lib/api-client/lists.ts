import { apiClient } from './client';
import type { ListTargetType, ListVisibility } from '@/lib/types/lists';
import type { EnrichedListItem } from '@/lib/user-lists';

/**
 * User lists API client. Signed-in only — the server resolves the owner from
 * the session; anonymous callers get 401 and the UI shows a sign-in prompt.
 * Global routes only — lists deliberately have no tenant twin (they link to
 * global URLs; see src/app/api/lists/route.ts).
 */

export interface ListSummary {
  id: string;
  title: string;
  description: string;
  visibility: ListVisibility;
  items_count: number;
  created_at: string;
  updated_at: string;
  is_owner: boolean;
  /** Present when the request asked ?containing= */
  contains?: boolean;
  /** Present when the request asked ?covers=true */
  covers?: string[];
}

export const lists = {
  /** The signed-in caller's own lists. */
  getMine: async (params?: {
    containing?: { type: ListTargetType; id: string };
    covers?: boolean;
  }): Promise<{ lists: ListSummary[] }> => {
    const query = new URLSearchParams();
    if (params?.containing) query.set('containing', `${params.containing.type}:${params.containing.id}`);
    if (params?.covers) query.set('covers', 'true');
    const qs = query.toString();
    return await apiClient.get(`/api/lists${qs ? `?${qs}` : ''}`);
  },

  create: async (params: {
    title: string;
    description?: string;
    visibility?: ListVisibility;
  }): Promise<{ success: boolean; list: ListSummary }> => {
    return await apiClient.post('/api/lists', {
      title: params.title,
      description: params.description,
      visibility: params.visibility,
    });
  },

  get: async (id: string): Promise<{ list: ListSummary; items: EnrichedListItem[] }> => {
    return await apiClient.get(`/api/lists/${id}`);
  },

  update: async (
    id: string,
    updates: { title?: string; description?: string; visibility?: ListVisibility }
  ): Promise<{ success: boolean; list: ListSummary }> => {
    return await apiClient.patch(`/api/lists/${id}`, updates);
  },

  remove: async (id: string): Promise<{ success: boolean }> => {
    // POST-based delete: src/proxy.ts blocks the DELETE method globally.
    return await apiClient.post(`/api/lists/${id}`, { action: 'delete' });
  },

  toggleItem: async (params: {
    listId: string;
    action: 'add' | 'remove';
    targetType: ListTargetType;
    targetId: string;
  }): Promise<{ success: boolean; in_list: boolean; items_count: number }> => {
    return await apiClient.post(`/api/lists/${params.listId}/items`, {
      action: params.action,
      target_type: params.targetType,
      target_id: params.targetId,
    });
  },
};
