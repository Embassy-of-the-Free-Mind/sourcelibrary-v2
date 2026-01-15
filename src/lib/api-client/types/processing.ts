/**
 * Processing Types
 */

export type ProcessingOperation = 'ocr' | 'translate' | 'summarize' | 'modernize';

export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface BatchProcessRequest {
  book_id: string;
  page_ids: string[];
  operation: ProcessingOperation;
  model?: string;
  prompt_name?: string;
}

export interface SingleProcessRequest {
  page_id: string;
  operation: ProcessingOperation;
  model?: string;
  prompt_name?: string;
}

export interface BatchProcessResponse {
  job_id: string;
  queued: number;
}

export interface SingleProcessResponse {
  success: boolean;
  result?: any;
}

export interface ProcessingStatusResponse {
  job_id: string;
  status: ProcessingStatus;
  progress: number;
  total: number;
  errors?: string[];
}

export interface ProcessingCancelResponse {
  success: boolean;
}

export interface ProcessingRetryResponse {
  success: boolean;
  retried: number;
}
