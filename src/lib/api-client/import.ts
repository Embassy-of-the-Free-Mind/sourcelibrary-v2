import { apiClient } from './client';
import type {
  ImportFromIARequest,
  ImportFromGallicaRequest,
  ImportFromMDZRequest,
  ImportFromBodleianRequest,
  ImportFromCambridgeRequest,
  ImportFromHABRequest,
  ImportFromVaticanRequest,
  ImportFromGoogleBooksRequest,
  ImportFromEuropeanaRequest,
  ImportResponse
} from './types/import';

/**
 * Import API client
 * Handles importing books from external digital library sources
 */
export const importBooks = {
  fromIA: async (request: ImportFromIARequest): Promise<ImportResponse> => {
    return await apiClient.post('/api/import/ia', request);
  },

  fromGallica: async (request: ImportFromGallicaRequest): Promise<ImportResponse> => {
    return await apiClient.post('/api/import/gallica', request);
  },

  fromMDZ: async (request: ImportFromMDZRequest): Promise<ImportResponse> => {
    return await apiClient.post('/api/import/mdz', request);
  },

  fromBodleian: async (request: ImportFromBodleianRequest): Promise<ImportResponse> => {
    return await apiClient.post('/api/import/bodleian', request);
  },

  fromCambridge: async (request: ImportFromCambridgeRequest): Promise<ImportResponse> => {
    return await apiClient.post('/api/import/cambridge', request);
  },

  fromHAB: async (request: ImportFromHABRequest): Promise<ImportResponse> => {
    return await apiClient.post('/api/import/hab', request);
  },

  fromVatican: async (request: ImportFromVaticanRequest): Promise<ImportResponse> => {
    return await apiClient.post('/api/import/vatican', request);
  },

  fromGoogleBooks: async (request: ImportFromGoogleBooksRequest): Promise<ImportResponse> => {
    return await apiClient.post('/api/import/google-books', request);
  },

  fromEuropeana: async (request: ImportFromEuropeanaRequest): Promise<ImportResponse> => {
    return await apiClient.post('/api/import/europeana', request);
  },

  status: async (jobId: string): Promise<{ status: string; progress: number; message?: string }> => {
    return await apiClient.get(`/api/import/status/${jobId}`);
  },
};
