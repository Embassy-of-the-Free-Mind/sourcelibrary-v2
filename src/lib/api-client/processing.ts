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
   * Batch OCR processing (direct, not job-based)
   */
  batchOcr: async (data: {
    pages: Array<{
      pageId: string;
      imageUrl: string;
      language?: string;
      previousOcr?: string;
      customPrompt?: string;
    }>;
    autoSave?: boolean;
    model?: string;
  }): Promise<{
    results: Array<{
      pageId: string;
      success: boolean;
      ocr?: string;
      error?: string;
      duration?: number;
    }>;
    totalDuration: number;
  }> => {
    return await apiClient.post('/api/process/batch', data);
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
  retry: async (jobId: string): Promise<{ success: boolean; retried: number }> => {
    return await apiClient.post(`/api/process/retry/${jobId}`, {});
  },

  /**
   * Batch translate with context (used for sequential translation with continuity)
   */
  batchTranslate: async (data: {
    pages: Array<{
      pageId: string;
      ocrText: string;
      pageNumber: number;
    }>;
    sourceLanguage: string;
    targetLanguage: string;
    customPrompt?: string;
    model?: string;
    previousContext?: string;
    overwrite?: boolean;
  }): Promise<{
    translations: Record<string, string>;
    translatedCount: number;
    requestedCount: number;
    skippedCount?: number;
    message?: string;
    usage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      costUsd: number;
    };
  }> => {
    // Batch translation can take 30-60 seconds, override default timeout
    return await apiClient.post('/api/process/batch-translate', data, {
      timeout: 120000, // 2 minutes
    });
  },

  /**
   * Batch OCR processing with ML
   */
  batchOcrProcess: async (data: {
    pages: Array<{
      pageId: string;
      imageUrl: string;
      pageNumber: number;
    }>;
    language: string;
    customPrompt?: string;
    model?: string;
    overwrite?: boolean;
  }): Promise<{
    ocrResults: Record<string, string>;
    processedCount: number;
    skippedCount: number;
    requestedCount: number;
    skippedPageIds: string[];
    failedPageIds: string[];
    message?: string;
    pageResults?: Array<{
      pageId: string;
      status: string;
      message: string;
    }>;
    usage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      costUsd: number;
    };
  }> => {
    // Batch OCR can take 30-60 seconds with image processing, override default timeout
    return await apiClient.post('/api/process/batch-ocr', data, {
      timeout: 120000, // 2 minutes
    });
  },

  /**
   * Batch image extraction from pages
   */
  batchImageExtraction: async (data: {
    pages: Array<{
      pageId: string;
      imageUrl: string;
      pageNumber: number;
    }>;
    model?: string;
    overwrite?: boolean;
  }): Promise<{
    detectionResults: Record<string, any>;
    skippedPageIds?: string[];
    failedPageIds?: string[];
    pageResults?: Array<{
      pageId: string;
      status: string;
      message: string;
    }>;
    usage?: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      costUsd: number;
    };
  }> => {
    // Batch image extraction can take 30-60 seconds with AI processing, override default timeout
    return await apiClient.post('/api/process/batch-image-extraction', data, {
      timeout: 120000, // 2 minutes
    });
  },
};
