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
    'pending' |
    'processing' |
    'paused' |
    'completed' |
    'failed' |
    'cancelled';

export interface JobProgress {
  total: number;
  completed: number;
  failed: number;
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
  initiated_by?: string;  // Name/email of user who started the job
  created_at: Date;
  updated_at: Date;
  started_at?: Date;
  completed_at?: Date;
  error?: string;
  results: JobResult[];
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