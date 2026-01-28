/**
 * Jobs API Types
 * Shared between API client and route handlers
 */
import type { Job, JobStatus, JobType } from '@/lib/types';

/**
 * Request body for creating a new job
 * Note: API expects page_ids/model/prompt_name at top level (not nested in config)
 * The API will construct the nested config object internally
 */
export interface JobCreateRequest {
  type: JobType;
  book_id?: string;
  book_title?: string;
  page_ids: string[];           // Required at top level
  model?: string;               // Optional at top level
  prompt_name?: string;         // Optional at top level
  language?: string;
  initiated_by?: string;
  use_batch_api?: boolean;      // Enable Gemini Batch API (50% discount)
}

export interface JobLog {
  id: string;
  type: JobType;
  status: 'pending' | 'processing' | 'paused' | 'completed' | 'failed' | 'cancelled';
  progress: {
    total: number;
    completed: number;
    failed: number;
  };
  book_id?: string;
  book_title?: string;
  initiated_by?: string;
  created_at: string;
  updated_at: string;
  started_at?: string;
  completed_at?: string;
  error?: string;
  config: {
    model?: string;
    prompt_name?: string;
    language?: string;
    page_ids?: string[];
  };
}

export interface JobsListResponse {
  jobs: JobLog[];
}

export interface JobProcessResponse {
  success?: boolean;
  processed?: number;
  message?: string;
  done?: boolean;
  paused?: boolean;
  job?: Job;  // The actual job object with updated status/progress
  // Batch API specific fields
  phase?: string;
  prepared?: number;
  failed?: number;
  remaining?: number;
  batches?: string[];
  collected?: number;
}

export interface JobStatusUpdateRequest {
  status: JobStatus;
}

export interface JobStatusUpdateResponse {
  success: boolean;
  job: Job;
}
