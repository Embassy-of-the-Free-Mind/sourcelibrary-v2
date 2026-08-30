import { apiClient, getTenantSlug } from './client';
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
  PageDetectSplitResponse,
  PageAskRequest,
  PageAskResponse
} from './types/pages';

/**
 * Pages API client
 * Handles individual page operations (OCR, translation, splitting)
 * All routes are tenant-scoped: /api/[tenant]/pages/...
 */
export const pages = {
  /**
   * Get a single page by ID.
   *
   * `cite` (#4357): citation token from a /q/ quote link — the server
   * serves this one page ungated to a valid token even past the metered
   * reader's free sample.
   */
  get: async (id: string, opts?: { cite?: string }): Promise<Page> => {
    const tenant = getTenantSlug();
    const query = opts?.cite ? `?cite=${encodeURIComponent(opts.cite)}` : '';
    return await apiClient.get(`/api/${tenant}/pages/${id}${query}`);
  },

  /**
   * Get multiple pages by ID in a single request.
   * Used by the reader to prefetch adjacent pages without triggering rate limits.
   */
  getBatch: async (ids: string[]): Promise<Page[]> => {
    const tenant = getTenantSlug();
    const data = await apiClient.post(`/api/${tenant}/pages/batch`, { ids }) as unknown as { pages: Page[] };
    return data.pages;
  },

  /**
   * Update page content (OCR, translation, summary)
   */
  update: async (id: string, updates: PageUpdateRequest): Promise<PageUpdateResponse> => {
    const tenant = getTenantSlug();
    return await apiClient.patch(`/api/${tenant}/pages/${id}`, updates);
  },

  /**
   * Delete a page
   */
  delete: async (id: string): Promise<{ success: boolean }> => {
    const tenant = getTenantSlug();
    return await apiClient.delete(`/api/${tenant}/pages/${id}`);
  },

  /**
   * OCR a single page
   */
  ocr: async (id: string, request: PageOcrRequest = {}): Promise<PageOcrResponse> => {
    const tenant = getTenantSlug();
    return await apiClient.post(`/api/${tenant}/pages/${id}/ocr`, request);
  },

  /**
   * Translate a single page
   */
  translate: async (id: string, request: PageTranslateRequest = {}): Promise<PageTranslateResponse> => {
    const tenant = getTenantSlug();
    return await apiClient.post(`/api/${tenant}/pages/${id}/translate`, request);
  },

  /**
   * Summarize a page
   */
  summarize: async (id: string): Promise<{ summary: string }> => {
    const tenant = getTenantSlug();
    return await apiClient.post(`/api/${tenant}/pages/${id}/summarize`);
  },

  /**
   * Detect if page is a two-page spread
   */
  detectSplit: async (id: string): Promise<PageDetectSplitResponse> => {
    const tenant = getTenantSlug();
    return await apiClient.post(`/api/${tenant}/pages/${id}/detect-split`);
  },

  /**
   * Split a two-page spread into two pages
   */
  split: async (id: string, splitPosition: number): Promise<PageSplitResponse> => {
    const tenant = getTenantSlug();
    return await apiClient.post(`/api/${tenant}/pages/${id}/split`, { split_position: splitPosition });
  },

  /**
   * Create a snapshot/backup of page content before reprocessing
   */
  snapshot: async (id: string, type: 'pre_ocr' | 'pre_translate' | 'manual_backup'): Promise<{ snapshot_id: string }> => {
    const tenant = getTenantSlug();
    return await apiClient.post(`/api/${tenant}/pages/${id}/snapshot`, { snapshot_type: type });
  },

  /**
   * Restore page from a snapshot
   */
  restore: async (id: string, snapshotId: string): Promise<PageUpdateResponse> => {
    const tenant = getTenantSlug();
    return await apiClient.post(`/api/${tenant}/pages/${id}/restore`, { snapshot_id: snapshotId });
  },

  /**
   * Get page snapshots
   */
  snapshots: async (id: string): Promise<{ snapshots: Array<any> }> => {
    const tenant = getTenantSlug();
    return await apiClient.get(`/api/${tenant}/pages/${id}/snapshots`);
  },

  /**
   * Ask a question about page content
   */
  ask: async (id: string, request: PageAskRequest): Promise<PageAskResponse> => {
    const tenant = getTenantSlug();
    return await apiClient.post(`/api/${tenant}/pages/${id}/ask`, request);
  },

  /**
   * Modernize page text
   */
  modernize: async (id: string): Promise<{ modernized: string }> => {
    const tenant = getTenantSlug();
    return await apiClient.post(`/api/${tenant}/pages/${id}/modernize`);
  },

  /**
   * Transliterate page OCR text (non-Latin scripts to Latin characters)
   */
  transliterate: async (id: string): Promise<{ transliteration: string; cached?: boolean; script?: string }> => {
    const tenant = getTenantSlug();
    return await apiClient.post(`/api/${tenant}/pages/${id}/transliterate`);
  },

  /**
   * Batch split two-page spreads into separate pages
   */
  batchSplit: async (splits: Array<{
    pageId: string;
    splitPosition: number;
    detectedPosition?: number;
    wasAdjusted?: boolean;
  }>, options?: { confirmClearOcr?: boolean }): Promise<{
    success?: boolean;
    warning?: boolean;
    pagesWithOcr?: number;
    pagesWithTranslation?: number;
    splitCount?: number;
    totalPages?: number;
    adjustmentsLogged?: number;
    ocrCleared?: number;
    translationCleared?: number;
    imagesGenerated?: number;
    thumbnailsGenerated?: number;
    imageErrors?: number;
    message: string;
  }> => {
    const tenant = getTenantSlug();
    return await apiClient.post(`/api/${tenant}/pages/batch-split`, {
      splits,
      ...(options?.confirmClearOcr && { confirmClearOcr: true })
    }, { timeout: 300000 });
  },

  /**
   * Batch reset split pages back to original state
   */
  batchReset: async (pageIds: string[]): Promise<{
    success: boolean;
    resetCount: number;
    totalPages: number;
  }> => {
    const tenant = getTenantSlug();
    return await apiClient.post(`/api/${tenant}/pages/batch-reset`, { pageIds }, { timeout: 120000 });
  },

  /**
   * Reset split status for a page
   */
  resetSplit: async (id: string): Promise<{ success: boolean }> => {
    const tenant = getTenantSlug();
    return await apiClient.post(`/api/${tenant}/pages/${id}/reset`, {}, { timeout: 60000 });
  },

  /**
   * Apply a quick fix to a page field
   */
  quickFix: async (id: string, field: string, fix: any): Promise<{ success: boolean; page: Page }> => {
    const tenant = getTenantSlug();
    return await apiClient.patch(`/api/${tenant}/pages/${id}/quick-fix`, { field, fix });
  },
};
