import { apiClient } from './client';
import type { Page } from '@/lib/types';
import type {
  PageOcrRequest,
  PageOcrResponse,
  PageTranslateRequest,
  PageTranslateResponse,
  PageUpdateRequest,
  PageUpdateResponse,
  PageSplitRequest,
  PageSplitResponse,
  PageDetectSplitResponse
} from './types/pages';

/**
 * Pages API client
 * Handles individual page operations (OCR, translation, splitting)
 */
export const pages = {
  /**
   * Get a single page by ID
   */
  get: async (id: string): Promise<Page> => {
    return await apiClient.get(`/api/pages/${id}`);
  },

  /**
   * Update page content (OCR, translation, summary)
   */
  update: async (id: string, updates: PageUpdateRequest): Promise<PageUpdateResponse> => {
    return await apiClient.patch(`/api/pages/${id}`, updates);
  },

  /**
   * Delete a page
   */
  delete: async (id: string): Promise<{ success: boolean }> => {
    return await apiClient.delete(`/api/pages/${id}`);
  },

  /**
   * OCR a single page
   */
  ocr: async (id: string, request: PageOcrRequest = {}): Promise<PageOcrResponse> => {
    return await apiClient.post(`/api/pages/${id}/ocr`, request);
  },

  /**
   * Translate a single page
   */
  translate: async (id: string, request: PageTranslateRequest = {}): Promise<PageTranslateResponse> => {
    return await apiClient.post(`/api/pages/${id}/translate`, request);
  },

  /**
   * Summarize a page
   */
  summarize: async (id: string): Promise<{ summary: string }> => {
    return await apiClient.post(`/api/pages/${id}/summarize`);
  },

  /**
   * Detect if page is a two-page spread
   */
  detectSplit: async (id: string): Promise<PageDetectSplitResponse> => {
    return await apiClient.post(`/api/pages/${id}/detect-split`);
  },

  /**
   * Split a two-page spread into two pages
   */
  split: async (id: string, splitPosition: number): Promise<PageSplitResponse> => {
    return await apiClient.post(`/api/pages/${id}/split`, { split_position: splitPosition });
  },

  /**
   * Create a snapshot/backup of page content before reprocessing
   */
  snapshot: async (id: string, type: 'pre_ocr' | 'pre_translate' | 'manual_backup'): Promise<{ snapshot_id: string }> => {
    return await apiClient.post(`/api/pages/${id}/snapshot`, { snapshot_type: type });
  },

  /**
   * Restore page from a snapshot
   */
  restore: async (id: string, snapshotId: string): Promise<PageUpdateResponse> => {
    return await apiClient.post(`/api/pages/${id}/restore`, { snapshot_id: snapshotId });
  },

  /**
   * Get page snapshots
   */
  snapshots: async (id: string): Promise<{ snapshots: Array<any> }> => {
    return await apiClient.get(`/api/pages/${id}/snapshots`);
  },

  /**
   * Modernize page text
   */
  modernize: async (id: string): Promise<{ modernized: string }> => {
    return await apiClient.post(`/api/pages/${id}/modernize`);
  },
};
