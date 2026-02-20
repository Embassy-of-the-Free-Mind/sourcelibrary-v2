import { apiClient } from './client';
import type {
  CuratorSessionListResponse,
  CuratorSessionDetailResponse,
  CuratorSessionListParams,
  CuratorSessionDetailParams,
} from './types/research';

/**
 * Research sessions API client
 */
export const research = {
  list: async (params?: CuratorSessionListParams): Promise<CuratorSessionListResponse> => {
    const qs = new URLSearchParams();
    if (params?.theme) qs.append('theme', params.theme);
    if (params?.type) qs.append('type', params.type);
    if (params?.sort) qs.append('sort', params.sort);
    if (params?.limit) qs.append('limit', params.limit.toString());
    if (params?.offset) qs.append('offset', params.offset.toString());
    const query = qs.toString();
    return await apiClient.get(`/api/research${query ? `?${query}` : ''}`);
  },

  get: async (id: string, params?: CuratorSessionDetailParams): Promise<CuratorSessionDetailResponse> => {
    const qs = new URLSearchParams();
    if (params?.page) qs.append('page', params.page.toString());
    if (params?.per_page) qs.append('per_page', params.per_page.toString());
    const query = qs.toString();
    return await apiClient.get(`/api/research/${id}${query ? `?${query}` : ''}`);
  },
};
