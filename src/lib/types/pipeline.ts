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