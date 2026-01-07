import { apiClient } from './client';
import type {
  Prompt,
  PromptCreateRequest,
  PromptUpdateRequest,
  PromptListParams,
  PromptListResponse
} from './types/prompts';

/**
 * Prompts API client
 * Handles versioned prompts for OCR, translation, and other AI operations
 */
export const prompts = {
  /**
   * Get all prompts with filters
   */
  list: async (params?: PromptListParams): Promise<PromptListResponse> => {
    const queryParams = new URLSearchParams();
    if (params?.type) queryParams.append('type', params.type);
    if (params?.language) queryParams.append('language', params.language);
    if (params?.is_default !== undefined) queryParams.append('is_default', params.is_default.toString());

    const query = queryParams.toString();
    return await apiClient.get(`/api/prompts${query ? `?${query}` : ''}`);
  },

  /**
   * Get a single prompt by ID
   */
  get: async (id: string): Promise<Prompt> => {
    return await apiClient.get(`/api/prompts/${id}`);
  },

  /**
   * Get a prompt by name and version
   */
  getByName: async (name: string, version?: string): Promise<Prompt> => {
    const params = version ? `?version=${version}` : '';
    return await apiClient.get(`/api/prompts/name/${name}${params}`);
  },

  /**
   * Create a new prompt
   */
  create: async (prompt: PromptCreateRequest): Promise<Prompt> => {
    return await apiClient.post('/api/prompts', prompt);
  },

  /**
   * Update a prompt
   */
  update: async (id: string, updates: PromptUpdateRequest): Promise<Prompt> => {
    return await apiClient.patch(`/api/prompts/${id}`, updates);
  },

  /**
   * Delete a prompt
   */
  delete: async (id: string): Promise<{ success: boolean }> => {
    return await apiClient.delete(`/api/prompts/${id}`);
  },

  /**
   * Set a prompt as default for its type/language
   */
  setDefault: async (id: string): Promise<Prompt> => {
    return await apiClient.post(`/api/prompts/${id}/set-default`);
  },

  /**
   * Get default prompt for a type and language
   */
  getDefault: async (type: string, language?: string): Promise<Prompt> => {
    const params = language ? `?language=${language}` : '';
    return await apiClient.get(`/api/prompts/default/${type}${params}`);
  },
};
