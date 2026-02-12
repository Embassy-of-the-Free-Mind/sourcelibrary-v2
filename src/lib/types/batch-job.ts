import type { JobType, JobStatus } from './job';

/**
 * Batch job record for batch_jobs collection
 * Supports parent-child architecture for multi-batch processing
 */
export interface BatchJob {
  id: string;
  type: JobType;
  status: JobStatus;
  book_id: string;
  book_title?: string;

  // For parent jobs
  total_pages?: number;
  child_job_ids?: string[];
  progress?: {
    completed: number;
    failed: number;
    pending: number;
    total: number;
  };

  // For child jobs
  parent_job_id?: string;
  job_name?: string;  // Gemini batch job name (operations/xyz)
  page_ids?: string[];
  page_count?: number;

  // Processing metadata
  model?: string;
  language?: string;
  prompt_version?: string;
  force?: boolean;  // Overwrite existing data

  // Timestamps
  created_at: Date;
  updated_at: Date;
  completed_at?: Date;

  // Results (for child jobs)
  completed_pages?: number;
  failed_pages?: number;
}
