/**
 * Experiments API Types
 * Shared between API client and route handlers
 */

export interface Experiment {
  id: string;
  _id?: string;
  name: string;
  description?: string;
  type: 'ocr' | 'translation' | 'comparison';
  status: 'draft' | 'running' | 'completed' | 'failed';
  config: Record<string, any>;
  results?: Record<string, any>;
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
  message: string;
  job_id?: string;
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
  created_at: Date;
  updated_at?: Date;
}

export interface OcrQualityCreateRequest {
  name: string;
  description?: string;
  book_id: string;
  page_sample_ids: string[];
  models: string[];
  prompts: string[];
}
