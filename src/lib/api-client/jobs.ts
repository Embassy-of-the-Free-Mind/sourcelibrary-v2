import { apiClient } from './client';
import type { Job, JobStatus } from '@/lib/types';
import type {
  JobCreateRequest,
  JobsListResponse,
  JobProcessResponse,
  JobStatusUpdateRequest,
  JobStatusUpdateResponse
} from './types/jobs';

/**
 * Jobs API client
 * Handles job queue and processing operations
 */

/**
 * Jobs API client
 * Handles job queue and processing operations
 */
export const jobs = {
  /**
   * Get all jobs with optional filters
   */
  list: async (params?: { limit?: number; status?: JobStatus; type?: string; book_id?: string }): Promise<JobsListResponse> => {
    const queryParams = new URLSearchParams();
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.status) queryParams.append('status', params.status);
    if (params?.type) queryParams.append('type', params.type);
    if (params?.book_id) queryParams.append('book_id', params.book_id);

    const query = queryParams.toString();
    return await apiClient.get(`/api/jobs${query ? `?${query}` : ''}`);
  },

  /**
   * Get a single job by ID
   */
  get: async (id: string): Promise<Job> => {
    return await apiClient.get(`/api/jobs/${id}`);
  },

  /**
   * Create a new job
   */
  create: async (job: JobCreateRequest): Promise<Job> => {
    return await apiClient.post('/api/jobs', job);
  },

  /**
   * Update job status
   */
  updateStatus: async (id: string, status: JobStatus): Promise<JobStatusUpdateResponse> => {
    return await apiClient.patch(`/api/jobs/${id}`, { status });
  },

  /**
   * Update job (status, progress, results, etc.)
   */
  update: async (id: string, updates: Partial<Job>): Promise<Job> => {
    return await apiClient.patch(`/api/jobs/${id}`, updates);
  },

  /**
   * Cancel a job
   */
  cancel: async (id: string): Promise<{ success: boolean }> => {
    return await apiClient.post(`/api/jobs/${id}/cancel`);
  },

  /**
   * Pause a job
   */
  pause: async (id: string): Promise<{ success: boolean }> => {
    return await apiClient.post(`/api/jobs/${id}/pause`);
  },

  /**
   * Resume a paused job
   */
  resume: async (id: string): Promise<{ success: boolean }> => {
    return await apiClient.post(`/api/jobs/${id}/resume`);
  },

  /**
   * Delete a job
   */
  delete: async (id: string): Promise<{ success: boolean }> => {
    return await apiClient.delete(`/api/jobs/${id}`);
  },

  /**
   * Process a job (execute next batch of work)
   */
  process: async (id: string): Promise<JobProcessResponse> => {
    return await apiClient.post(`/api/jobs/${id}/process`);
  },

  /**
   * Retry a failed job
   */
  retry: async (id: string): Promise<{ success: boolean }> => {
    return await apiClient.post(`/api/jobs/${id}/retry`);
  },

  /**
   * Get job results
   */
  results: async (id: string): Promise<{ results: Array<any> }> => {
    return await apiClient.get(`/api/jobs/${id}/results`);
  },
};
