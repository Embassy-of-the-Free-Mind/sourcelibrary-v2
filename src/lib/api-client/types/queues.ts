/**
 * Queue Payload Types
 * Shared between queue client and queue handlers
 */

import type { JobType } from '@/lib/types/job';

/**
 * Response from queue-books endpoint
 */
export interface QueueBooksResponse {
  success: boolean;
  jobId: string;           // Single job ID for tracking
  pageCount: number;       // Number of pages queued
  message?: string;
}

/**
 * Request body for queue-books endpoint (new granular architecture)
 */
export interface QueueBooksRequest {
  bookId: string;          // Book ID
  pageIds: string[];       // Specific page IDs to process
  action: JobType;         // 'ocr' | 'translation' | 'image_extraction'
  customPrompt?: string;   // Optional custom prompt for OCR/translation
}
