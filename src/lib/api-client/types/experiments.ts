/**
 * Experiments API Types
 * Shared between API client and route handlers
 */

export interface Experiment {
  id: string;
  _id?: string;
  name: string;
  description?: string;
  type: 'ocr' | 'translation' | 'comparison' | 'ocr_quality' | 'translation_comparison';
  status: 'draft' | 'running' | 'completed' | 'failed' | 'pending';
  config: Record<string, any>;
  results?: Record<string, any>;

  // Nested objects for OCR quality experiments
  experiment?: {
    book_id: string;
    model_a: string;
    model_b: string;
  };

  book?: {
    title: string;
    author: string;
  };

  created_at: Date;
  updated_at?: Date;
  completed_at?: Date;
}

export interface ExperimentCreateRequest {
  name: string;
  description?: string;
  type: 'ocr' | 'translation' | 'comparison';
  config: Record<string, any>;
}

export interface ExperimentUpdateRequest {
  name?: string;
  description?: string;
  status?: 'draft' | 'running' | 'completed' | 'failed';
  config?: Record<string, any>;
  results?: Record<string, any>;
}

export interface ExperimentListResponse {
  experiments: Experiment[];
  total: number;
}

export interface ExperimentRunResponse {
  success: boolean;
  message?: string;
  job_id?: string;
  pages_processed?: number;
  results_count?: number;
  total_cost?: number;
}

export interface OcrQualityExperiment {
  id: string;
  name: string;
  description?: string;
  book_id: string;
  book_title?: string;
  page_sample_ids: string[];
  models: string[];
  prompts: string[];
  status: 'draft' | 'running' | 'completed' | 'failed';
  results?: Array<{
    page_id: string;
    page_number: number;
    model: string;
    prompt: string;
    ocr_text: string;
    judgment?: {
      score: number;
      reasoning: string;
      judge_model: string;
    };
  }>;

  // Additional nested fields for experiment pages
  comparison?: {
    page_number: number;
    model_a_text: string;
    model_b_text: string;
  };

  stats?: {
    total: number;
    judged: number;
    pending: number;
  };

  progress?: {
    current: number;
    total: number;
  };

  judging_progress?: {
    judged: number;
    total: number;
    percentage: number;
  };

  experiment_id?: string;
  is_complete?: boolean;

  created_at: Date;
  updated_at?: Date;
}

export interface OcrQualityCreateRequest {
  name: string;
  description?: string;
  book_id: string;
  page_sample_ids?: string[];
  models: string[];
  prompts?: string[];
  model_a?: string;
  model_b?: string;
  start_page?: number;
  page_count?: number;
}

export interface ExperimentJudgeResponse {
  success: boolean;
  judged: number;
  is_complete: boolean;
}

export interface ExperimentStatsResponse {
  stats: {
    total: number;
    by_type: Record<string, number>;
  };
}
