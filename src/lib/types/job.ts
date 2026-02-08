export type JobType =
    // New granular job queue architecture
    'ocr' |                  // OCR for selected pages
    'translation' |          // Translation for selected pages
    'summary' |              // Summary generation for selected pages
    'image_extraction';      // Image extraction for selected pages

export type JobStatus =
    'pending' |                // Job created, not started (workers haven't picked it up yet)
    'processing' |             // Workers are actively processing pages
    'completed' |              // All pages processed successfully
    'completed_with_errors' |  // All pages attempted, some failed (retryable)
    'failed' |                 // Job failed completely
    'cancelled' |              // User cancelled the job
    'partial';                 // Legacy: same as completed_with_errors

export interface JobProgress {
  total: number;       // Total pages in this job
  completed: number;   // Pages completed successfully
  failed?: number;     // Pages that failed (optional, for retry logic)
}

export interface JobResult {
  pageId: string;
  success: boolean;
  error?: string;
  duration?: number;
}

export interface WorkflowState {
  currentStep: 'ocr' | 'translation' | null;
  ocrMode: 'missing' | 'all';
  translationMode: 'missing' | 'all';
  ocrProcessedIds: string[];
  translationProcessedIds: string[];
  ocrFailedIds: string[];
  translationFailedIds: string[];
  selectedModel: string;
  ocrPromptId?: string;
  translationPromptId?: string;
  stepsEnabled: { ocr: boolean; translation: boolean };
}

export interface Job {
  _id?: unknown;
  id: string;
  type: JobType;
  status: JobStatus;
  progress: JobProgress;
  book_id?: string;
  book_title?: string;

  // New SQS-based fields
  failed_page_ids?: string[];  // Pages that failed (for retry)
  retry_count?: number;         // Number of retry attempts

  // Metadata
  initiated_by?: string;  // Name/email of user who started the job
  created_at: Date;
  updated_at: Date;
  started_at?: Date;
  completed_at?: Date;
  error?: string;

  // Legacy fields (backward compatibility)
  results?: JobResult[];
  workflow_state?: WorkflowState;  // For resumable processing
  config: {
    model?: string;
    prompt_name?: string;
    language?: string;
    page_ids?: string[];
    use_batch_api?: boolean;
    [key: string]: unknown;
  };
  // Gemini Batch API job name (for async processing)
  gemini_batch_job?: string;
  // Multiple batch jobs (for large jobs split into batches)
  gemini_batch_jobs?: Array<{
    name: string;
    page_ids?: string[];
    results_collected?: boolean;
    success_count?: number;
    fail_count?: number;
    error?: string;
  }>;
  // Batch processing phase
  batch_phase?: 'preparing' | 'submitted' | 'completed';
}

/**
 * Compute derived metrics from job progress counters.
 * These are calculated at runtime rather than stored in the database.
 */
export function getJobMetrics(job: Job) {
  const total = job.progress.total || 0;
  const completed = job.progress.completed || 0;
  const failed_count = job.failed_page_ids?.length || 0;
  const pending = total - completed - failed_count;

  return {
    total,
    completed,
    pending,
    failed_count,
    is_retryable: (job.status === 'completed_with_errors' || job.status === 'partial') && failed_count > 0,
    completion_percent: total > 0
      ? Math.round((completed / total) * 100)
      : 0
  };
}