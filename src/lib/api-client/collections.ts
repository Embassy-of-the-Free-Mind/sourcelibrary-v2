import { apiClient } from './client';
import type {
  CollectionsListResponse,
  CollectionDetailResponse,
} from './types/collections';

export const collections = {
  list: async (): Promise<CollectionsListResponse> =>
    apiClient.get('/api/collections'),

  get: async (
    slug: string,
    params?: { sort?: string; language?: string; limit?: number; offset?: number }
  ): Promise<CollectionDetailResponse> => {
    const qs = new URLSearchParams();
    if (params?.sort) qs.set('sort', params.sort);
    if (params?.language) qs.set('language', params.language);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    const query = qs.toString();
    return apiClient.get(`/api/collections/${slug}${query ? '?' + query : ''}`);
  },
};
