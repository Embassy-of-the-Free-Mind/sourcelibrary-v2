/**
 * Jobs API Types
 * Shared between API client and route handlers
 */
import type { Job, JobStatus } from '@/lib/types';

export interface JobsListResponse {
  jobs: Job[];
  total: number;
}

export interface JobProcessResponse {
  success: boolean;
  processed: number;
  message: string;
}

export interface JobStatusUpdateRequest {
  status: JobStatus;
}

export interface JobStatusUpdateResponse {
  success: boolean;
  job: Job;
}
