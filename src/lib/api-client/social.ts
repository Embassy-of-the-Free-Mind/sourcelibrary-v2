import { apiClient } from './client';
import type {
  SocialPost,
  SocialCandidate,
  SocialConfig,
  SocialConfigResponse,
  GeneratePostRequest,
  GeneratePostResponse,
  SocialTag,
  SocialTagsResponse
} from './types/social';

/**
 * Social Media API client
 * Handles social media posting and content generation
 */
export const social = {
  /**
   * Get social media posts
   */
  posts: async (): Promise<{ posts: SocialPost[] }> => {
    return await apiClient.get('/api/social/posts');
  },

  /**
   * Get post candidates
   */
  candidates: async (): Promise<{ candidates: SocialCandidate[] }> => {
    return await apiClient.get('/api/social/candidates');
  },

  /**
   * Get social media configuration
   */
  config: async (): Promise<SocialConfigResponse> => {
    return await apiClient.get('/api/social/config');
  },

  /**
   * Generate a social media post
   */
  generate: async (request: GeneratePostRequest): Promise<GeneratePostResponse> => {
    return await apiClient.post('/api/social/generate', request);
  },

  /**
   * Get available generation options (audiences, voices, models)
   */
  getGenerationOptions: async (): Promise<{
    audiences: Array<{ id: string; name: string; description: string }>;
    voices: Array<{ id: string; name: string; description: string; examples: string[] }>;
    models: Array<{ id: string; name: string; description: string }>;
  }> => {
    return await apiClient.get('/api/social/generate');
  },

  /**
   * Get popular tags
   */
  tags: async (): Promise<SocialTagsResponse> => {
    return await apiClient.get('/api/social/tags');
  },

  /**
   * Create a new social media post
   */
  createPost: async (data: {
    imageId: string;
    tweet_text?: string;
    hashtags?: string[];
    status?: 'draft' | 'queued';
    scheduled_for?: string;
  }): Promise<{ success: boolean; post: SocialPost }> => {
    return await apiClient.post('/api/social/posts', data);
  },

  /**
   * Update an existing social media post
   */
  updatePost: async (id: string, updates: Partial<SocialPost>): Promise<{ success: boolean; post: SocialPost }> => {
    return await apiClient.patch(`/api/social/posts/${id}`, updates);
  },

  /**
   * Publish a social media post
   */
  publishPost: async (id: string): Promise<{ success: boolean; tweetUrl?: string }> => {
    return await apiClient.post(`/api/social/posts/${id}/publish`, {});
  },

  /**
   * Delete a social media post
   */
  deletePost: async (id: string): Promise<{ success: boolean }> => {
    return await apiClient.delete(`/api/social/posts/${id}`);
  },

  /**
   * Update social media configuration
   */
  updateConfig: async (settings: {
    settings: Partial<{
      posts_per_day: number;
      posting_hours: number[];
      auto_post_enabled: boolean;
      min_gallery_quality: number;
    }>;
  }): Promise<{ success: boolean; config: SocialConfig }> => {
    return await apiClient.patch('/api/social/config', settings);
  },

  /**
   * Update a social media tag
   */
  updateTag: async (handle: string, data: Partial<SocialTag>): Promise<{ success: boolean; tag: SocialTag }> => {
    return await apiClient.patch(`/api/social/tags/${handle}`, data);
  },

  /**
   * Delete a social media tag
   */
  deleteTag: async (handle: string): Promise<{ success: boolean }> => {
    return await apiClient.delete(`/api/social/tags/${handle}`);
  },
};
