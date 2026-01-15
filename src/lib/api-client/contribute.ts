import { apiClient, streamRequest } from './client';
import type {  
  ContributeBook,
  ContributorStats,
  ValidateKeyResponse
} from './types/contribute';

/**
 * Contribute API client
 * Handles community contributions
 */
export const contribute = {
  /**
   * Get books available for contribution
   */
  books: async (): Promise<ContributeBook[]> => {
    return await apiClient.get('/api/contribute/books');
  },

  /**
   * Get contribution statistics
   */
  stats: async (): Promise<ContributorStats> => {
    return await apiClient.get('/api/contribute/stats');
  },

  /**
   * Validate contribution key
   */
  validateKey: async (key: string): Promise<ValidateKeyResponse> => {
    return await apiClient.post('/api/contribute/validate-key', { key });
  },

  /**
   * Process a contribution (non-streaming)
   */
  process: async (data: any): Promise<{ success: boolean }> => {
    return await apiClient.post('/api/contribute/process', data);
  },

  /**
   * Process a contribution with streaming updates (Server-Sent Events)
   * Returns a Response object with readable stream for real-time progress
   */
  processStream: async (data: {
    apiKey: string;
    bookId: string;
    processType: 'ocr' | 'translate' | 'both';
    contributorName: string;
    costLimit: number;
  }): Promise<Response> => {
    return await streamRequest('/api/contribute/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  },
};
