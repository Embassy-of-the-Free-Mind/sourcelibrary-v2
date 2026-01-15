import { apiClient } from './client';

/**
 * Split Detection API client
 * Handles ML-based detection and splitting of two-page spreads
 */
export const splitDetection = {
  /**
   * Detect if page is a two-page spread using ML
   */
  detect: async (pageId: string): Promise<{
    is_split: boolean;
    confidence: number;
    split_position?: number;
    reasoning?: string;
  }> => {
    return await apiClient.post(`/api/split-detection/detect`, { page_id: pageId });
  },

  /**
   * Batch detect splits for multiple pages
   */
  batchDetect: async (pageIds: string[]): Promise<{
    results: Array<{
      page_id: string;
      is_split: boolean;
      confidence: number;
      split_position?: number;
    }>;
  }> => {
    return await apiClient.post('/api/split-detection/batch', { page_ids: pageIds });
  },

  /**
   * Auto-split a page using ML detection
   */
  autoSplit: async (pageId: string): Promise<{
    success: boolean;
    left_page_id?: string;
    right_page_id?: string;
  }> => {
    return await apiClient.post(`/api/split-detection/auto-split`, { page_id: pageId });
  },

  /**
   * ML model operations
   */
  ml: {
    /**
     * Check ML model status
     */
    status: async (): Promise<{
      hasActiveModel: boolean;
      modelVersion?: string;
      trainingDataCount?: number;
    }> => {
      return await apiClient.get('/api/split-ml/train');
    },

    /**
     * Predict split position using ML model
     */
    predict: async (pageId: string): Promise<{
      split_position: number;
      confidence: number;
    }> => {
      return await apiClient.post('/api/split-ml/predict', { pageId });
    },
  },

  /**
   * Gemini-based split detection
   */
  gemini: {
    /**
     * Detect split using Gemini AI
     */
    detect: async (pageId: string): Promise<{
      split_position: number;
      confidence: number;
      reasoning?: string;
    }> => {
      return await apiClient.post('/api/split-gemini', { pageId });
    },
  },
};
