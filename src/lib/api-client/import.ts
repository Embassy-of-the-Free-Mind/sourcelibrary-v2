import { apiClient } from './client';
import type { Book } from '@/lib/types';
import type {
  ImportFromIARequest,
  ImportFromGallicaRequest,
  ImportFromMDZRequest,
  ImportResponse
} from './types/import';

/**
 * Import API client
 * Handles importing books from external sources (Internet Archive, Gallica, MDZ)
 */
export const importBooks = {
  /**
   * Import a book from Internet Archive
   */
  fromIA: async (request: ImportFromIARequest): Promise<ImportResponse> => {
    return await apiClient.post('/api/import/ia', request);
  },

  /**
   * Import a book from Gallica (Bibliothèque nationale de France)
   */
  fromGallica: async (request: ImportFromGallicaRequest): Promise<ImportResponse> => {
    return await apiClient.post('/api/import/gallica', request);
  },

  /**
   * Import a book from MDZ (Münchener DigitalisierungsZentrum)
   */
  fromMDZ: async (request: ImportFromMDZRequest): Promise<ImportResponse> => {
    return await apiClient.post('/api/import/mdz', request);
  },

  /**
   * Check import status
   */
  status: async (jobId: string): Promise<{ status: string; progress: number; message?: string }> => {
    return await apiClient.get(`/api/import/status/${jobId}`);
  },
};
