export type PipelineStep =
    'crop' |
    'ocr' |
    'translate' |
    'summarize' |
    'edition';

export type PipelineStatus =
    'idle'|
    'running' |
    'paused' |
    'completed' |
    'failed';

export interface PipelineStepState {
  status: 'pending' | 'running' | 'completed' | 'skipped' | 'failed';
  progress?: { completed: number; total: number };
  started_at?: Date;
  completed_at?: Date;
  error?: string;
  result?: Record<string, unknown>;
}

export interface PipelineConfig {
  model: string;
  language: string;
  license: string;
  useBatchApi?: boolean;
}

export interface PipelineState {
  status: PipelineStatus;
  currentStep: PipelineStep | null;

  steps: {
    crop: PipelineStepState;
    ocr: PipelineStepState;
    translate: PipelineStepState;
    summarize: PipelineStepState;
    edition: PipelineStepState;
  };

  started_at?: Date;
  completed_at?: Date;
  error?: string;

  config: PipelineConfig;
}

// ─── Auto Pipeline (cron-driven post-import processing) ───

export type PipelineAutoStatus =
  | 'queued'
  | 'archiving'
  | 'archive_complete'
  | 'ocr_submitted'
  | 'ocr_complete'
  | 'metadata_enriched' // legacy — books processed before Phase 1.6 migration
  | 'translate_submitted'
  | 'translate_complete'
  | 'enriching'
  | 'enriched'
  | 'chapters'
  | 'chapters_complete'
  | 'images_submitted'
  | 'images_complete'
  | 'complete'
  | 'needs_attention'
  | 'failed';

export interface PipelineAutoState {
  status: PipelineAutoStatus;
  source: 'import' | 'admin' | 'cron';
  queued_at: Date;
  started_at?: Date;
  completed_at?: Date;
  error?: string;
  retry_count?: number;
  /** Gemini Batch API job name for OCR */
  ocr_job_name?: string;
  /** Gemini Batch API job name for translation */
  translate_job_name?: string;
  /** batch_jobs collection ID for OCR */
  ocr_batch_id?: string;
  /** batch_jobs collection ID for translation */
  translate_batch_id?: string;
  /** Job ID for image extraction (links to jobs collection) */
  image_extraction_job_id?: string;
  /** Last time the cron touched this book */
  last_updated?: Date;
  /** How many times OCR has looped back (archive_complete → ocr_submitted → archive_complete) */
  ocr_loop_count?: number;
  /** How many times translation has looped back */
  translate_loop_count?: number;
}