import { apiClient } from './client';
import type { TimelineOverview, TimelineDrilldown } from './types/timeline';

export const timeline = {
  overview: async (params?: {
    language?: string;
    collection?: string;
  }): Promise<TimelineOverview> => {
    const qs = new URLSearchParams();
    if (params?.language) qs.set('language', params.language);
    if (params?.collection) qs.set('collection', params.collection);
    const query = qs.toString();
    return await apiClient.get(`/api/books/timeline${query ? '?' + query : ''}`);
  },

  decade: async (
    decade: number,
    params?: { limit?: number; offset?: number; language?: string; collection?: string }
  ): Promise<TimelineDrilldown> => {
    const qs = new URLSearchParams({ decade: String(decade) });
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    if (params?.language) qs.set('language', params.language);
    if (params?.collection) qs.set('collection', params.collection);
    return await apiClient.get(`/api/books/timeline?${qs}`);
  },
};
