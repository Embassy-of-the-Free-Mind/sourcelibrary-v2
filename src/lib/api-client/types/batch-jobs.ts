/**
 * Batch Jobs API Types
 * Shared between API client and route handlers
 */

export interface PendingStats {
  total_books: number;
  books_needing_ocr: number;
  books_needing_translation: number;
  total_pages_needing_ocr: number;
  total_pages_needing_translation: number;
  active_jobs: number;
  pending_batch_jobs: number;
}

export interface ProcessAllRequest {
  type?: 'ocr' | 'translate' | 'both';
  limit?: number;
}

export interface ProcessAllResponse {
  stats: PendingStats;
  ocr_jobs?: Array<{ job_id: string; book_id: string; book_title: string }>;
  translate_jobs?: Array<{ job_id: string; book_id: string; book_title: string }>;
  message?: string;
}

export interface ProcessPendingRequest {
  limit?: number;
}

export interface ProcessPendingResponse {
  processed: number;
  remaining: {
    needing_preparation: number;
    ready_to_run: number;
  };
  jobs_updated: string[];
}
