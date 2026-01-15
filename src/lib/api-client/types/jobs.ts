/**
 * Jobs API Types
 * Shared between API client and route handlers
 */
import type { Job, JobStatus, JobType } from '@/lib/types';

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
  success: boolean;
  processed: number;
  message: string;
  done?: boolean;
  paused?: boolean;
}

export interface JobStatusUpdateRequest {
  status: JobStatus;
}

export interface JobStatusUpdateResponse {
  success: boolean;
  job: Job;
}
