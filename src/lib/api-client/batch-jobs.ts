import { apiClient } from './client';
import type {
  PendingStats,
  ProcessAllRequest,
  ProcessAllResponse,
  ProcessPendingRequest,
  ProcessPendingResponse
} from './types/batch-jobs';

/**
 * Batch Jobs API client
 * Handles batch processing of OCR and translation jobs
 */

/**
 * Batch Jobs API client
 * Handles batch processing of OCR and translation jobs
 */
export const batchJobs = {
  /**
   * Get stats about pending work (GET /api/batch-jobs/process-all)
   */
  stats: async (): Promise<{ stats: PendingStats }> => {
    return await apiClient.get('/api/batch-jobs/process-all');
  },

  /**
   * Create batch jobs for books needing work (POST /api/batch-jobs/process-all)
   */
  processAll: async (request: ProcessAllRequest): Promise<ProcessAllResponse> => {
    const params = new URLSearchParams();
    if (request.type) params.append('type', request.type);
    if (request.limit) params.append('limit', request.limit.toString());

    return await apiClient.post(`/api/batch-jobs/process-all?${params}`);
  },

  /**
   * Process pending batch jobs (prepare them for execution)
   */
  processPending: async (request: ProcessPendingRequest): Promise<ProcessPendingResponse> => {
    const params = new URLSearchParams();
    if (request.limit) params.append('limit', request.limit.toString());

    return await apiClient.post(`/api/batch-jobs/process-pending?${params}`);
  },
};
