export type JobType = 
    'ocr'|
    'translate' |
    'batch_ocr' |
    'batch_translate' |
    'batch_summary' |
    'batch_split' |
    'book_import' |
    'generate_cropped_images' |
    'pipeline_stream' |
    'batch_extract_images';

export type JobStatus =
    // New SQS-based statuses
    'pending' |       // Job created, not started
    'ocr' |           // OCR in progress
    'translation' |   // Translation in progress
    'completed' |     // All pages processed successfully
    'partial' |       // Some pages failed after retries
    // Legacy statuses (backward compatibility)
    'processing' |
    'paused' |
    'failed' |
    'cancelled';

export interface JobProgress {
  total: number;
  // New SQS-based counters
  ocr_completed?: number;          // Pages with OCR done
  translation_completed?: number;  // Pages with translation done
  // Legacy counters (backward compatibility)
  completed?: number;
  failed?: number;
  currentItem?: string;
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
  // Use new counters if available, fall back to legacy
  const total = job.progress.total || 0;
  const ocr_completed = job.progress.ocr_completed ?? job.progress.completed ?? 0;
  const translation_completed = job.progress.translation_completed ?? 0;
  const failed_count = job.failed_page_ids?.length || 0;

  const ocr_pending = total - ocr_completed;
  const translation_pending = ocr_completed - translation_completed;

  return {
    ocr_pending,
    translation_pending,
    failed_count,
    is_retryable: job.status === 'partial' && failed_count > 0,
    completion_percent: total > 0
      ? Math.round((translation_completed / total) * 100)
      : 0
  };
}