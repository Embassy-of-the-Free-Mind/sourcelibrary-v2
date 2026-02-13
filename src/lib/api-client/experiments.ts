import { apiClient } from './client';
import type {
  Experiment,
  ExperimentCreateRequest,
  ExperimentUpdateRequest,
  ExperimentListResponse,
  ExperimentRunResponse,
  OcrQualityExperiment,
  OcrQualityCreateRequest
} from './types/experiments';

/**
 * Experiments API client
 * Handles A/B testing and quality experiments for OCR/translation
 */
export const experiments = {
  /**
   * Get all experiments
   */
  list: async (): Promise<ExperimentListResponse> => {
    return await apiClient.get('/api/experiments');
  },

  /**
   * Get a single experiment by ID
   */
  get: async (id: string): Promise<Experiment> => {
    return await apiClient.get(`/api/experiments/${id}`);
  },

  /**
   * Create a new experiment
   */
  create: async (experiment: ExperimentCreateRequest): Promise<Experiment> => {
    return await apiClient.post('/api/experiments', experiment);
  },

  /**
   * Update an experiment
   */
  update: async (id: string, updates: ExperimentUpdateRequest): Promise<Experiment> => {
    return await apiClient.patch(`/api/experiments/${id}`, updates);
  },

  /**
   * Delete an experiment
   */
  delete: async (id: string): Promise<{ success: boolean }> => {
    return await apiClient.delete(`/api/experiments/${id}`);
  },

  /**
   * Run an experiment
   */
  run: async (id: string): Promise<ExperimentRunResponse> => {
    return await apiClient.post(`/api/experiments/${id}/run`);
  },

  /**
   * Get experiment results
   */
  results: async (id: string): Promise<{ results: any }> => {
    return await apiClient.get(`/api/experiments/${id}/results`);
  },
};

/**
 * OCR Quality Experiments API client
 * Specialized experiments for testing OCR quality across models and prompts
 */
export const ocrQualityExperiments = {
  /**
   * Get all OCR quality experiments
   */
  list: async (): Promise<{ experiments: OcrQualityExperiment[] }> => {
    return await apiClient.get('/api/experiments/ocr-quality');
  },

  /**
   * Get an OCR quality experiment by ID
   */
  get: async (id: string): Promise<OcrQualityExperiment> => {
    return await apiClient.get(`/api/experiments/ocr-quality/${id}`);
  },

  /**
   * Create a new OCR quality experiment
   */
  create: async (experiment: OcrQualityCreateRequest): Promise<OcrQualityExperiment> => {
    return await apiClient.post('/api/experiments/ocr-quality', experiment);
  },

  /**
   * Run a single condition of an OCR quality experiment
   */
  run: async (id: string, conditionId: string): Promise<{ success: boolean; pages_processed?: number }> => {
    return await apiClient.post(`/api/experiments/ocr-quality/${id}/run`, { condition_id: conditionId });
  },

  /**
   * Get next blind comparison for manual judging
   */
  getNextJudgment: async (id: string): Promise<{
    comparison: {
      page_id: string;
      page_number: number;
      image_url: string;
      condition_a: string;
      condition_b: string;
      ocr_a: string;
      ocr_b: string;
      comparison_type: string;
      left_is_a: boolean;
    } | null;
    stats: { total: number; completed: number; remaining: number };
  }> => {
    return await apiClient.get(`/api/experiments/ocr-quality/${id}/judge`);
  },

  /**
   * Submit a single judgment
   */
  submitJudgment: async (id: string, data: {
    page_id: string;
    condition_a: string;
    condition_b: string;
    comparison_type: string;
    winner: 'a' | 'b' | 'tie';
  }): Promise<{ success: boolean }> => {
    return await apiClient.post(`/api/experiments/ocr-quality/${id}/judge`, data);
  },

  /**
   * Auto-judge OCR results with AI
   */
  autoJudge: async (id: string): Promise<{ success: boolean; judged: number }> => {
    return await apiClient.post(`/api/experiments/ocr-quality/${id}/auto-judge`);
  },

  /**
   * Get random results for judging
   */
  randomJudge: async (id: string, count: number = 5): Promise<{ results: Array<any> }> => {
    return await apiClient.get(`/api/experiments/ocr-quality/${id}/random-judge?count=${count}`);
  },

  /**
   * Get experiment results with analysis
   */
  results: async (id: string): Promise<{ results: any; analysis: any }> => {
    return await apiClient.get(`/api/experiments/ocr-quality/${id}/results`);
  },

  /**
   * Delete an OCR quality experiment
   */
  delete: async (id: string): Promise<{ success: boolean }> => {
    return await apiClient.delete(`/api/experiments/ocr-quality/${id}`);
  },
};

/**
 * Comparisons API client
 * Handles model/prompt comparisons
 */
export const comparisons = {
  /**
   * Get comparison statistics
   */
  stats: async (): Promise<{ total: number; by_type: Record<string, number> }> => {
    return await apiClient.get('/api/comparisons/stats');
  },

  /**
   * Create a new comparison
   */
  create: async (comparison: { type: string; models: string[]; prompts: string[]; sample_ids: string[] }): Promise<{ id: string }> => {
    return await apiClient.post('/api/comparisons', comparison);
  },

  /**
   * Get comparison results
   */
  get: async (id: string): Promise<any> => {
    return await apiClient.get(`/api/comparisons/${id}`);
  },
};
