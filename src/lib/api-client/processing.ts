import { apiClient } from './client';

/**
 * Processing API client
 * Handles batch processing operations for OCR, translation, and other AI tasks
 */
export const processing = {
  /**
   * Process a single page (OCR, translation, or summary)
   */
  process: async (data: {
    pageId: string;
    action: 'ocr' | 'translation' | 'summary' | 'all';
    imageUrl?: string;
    language?: string;
    targetLanguage?: string;
    ocrText?: string;
    translatedText?: string;
    previousPageId?: string;
    customPrompts?: {
      ocr?: string;
      translation?: string;
      summary?: string;
    };
    autoSave?: boolean;
    model?: string;
    promptInfo?: {
      ocr?: string;
      translation?: string;
      summary?: string;
    };
  }): Promise<{
    ocr?: string;
    translation?: string;
    summary?: string;
    usage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      costUsd: number;
    };
  }> => {
    return await apiClient.post('/api/process', data);
  },

  /**
   * Process batch of pages with AI (job-based)
   */
  batch: async (data: {
    book_id: string;
    page_ids: string[];
    operation: 'ocr' | 'translate' | 'summarize' | 'modernize';
    model?: string;
    prompt_name?: string;
  }): Promise<{ job_id: string; queued: number }> => {
    return await apiClient.post('/api/process/batch', data);
  },

  /**
   * Process a single item
   */
  single: async (data: {
    page_id: string;
    operation: 'ocr' | 'translate' | 'summarize' | 'modernize';
    model?: string;
    prompt_name?: string;
  }): Promise<{ success: boolean; result?: any }> => {
    return await apiClient.post('/api/process/single', data);
  },

  /**
   * Get processing status
   */
  status: async (jobId: string): Promise<{
    job_id: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    progress: number;
    total: number;
    errors?: string[];
  }> => {
    return await apiClient.get(`/api/process/status/${jobId}`);
  },

  /**
   * Cancel a processing job
   */
  cancel: async (jobId: string): Promise<{ success: boolean }> => {
    return await apiClient.post(`/api/process/cancel/${jobId}`, {});
  },

  /**
   * Retry failed items in a job
   */
  retry: async (jobId: string): Promise<{ success: boolean; retried: number; message?: string }> => {
    return await apiClient.post(`/api/jobs/${jobId}/retry`, {});
  },

};
