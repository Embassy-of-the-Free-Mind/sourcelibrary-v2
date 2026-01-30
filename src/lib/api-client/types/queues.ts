/**
 * Queue Payload Types
 * Shared between queue client and queue handlers
 */

/**
 * Payload for book-batch-ocr queue
 * Processes all pages of a book via Gemini Batch API (chunked into 50-page batches)
 */
export interface BookBatchOcrPayload {
  bookId: string;
  dbJobId: string;         // Database job record ID
  pageIds: string[];       // ALL page IDs for this book (sorted by page_number)
  model: string;           // e.g., 'gemini-3-flash-preview'
  language: string;        // e.g., 'Latin'
}

/**
 * Payload for batch-monitor queue
 * Self-re-enqueuing handler that monitors Gemini Batch API jobs until completion
 */
export interface BatchMonitorPayload {
  geminiBatchJobId: string;  // Gemini batch job name (e.g., 'batches/xyz123')
  jobType: 'ocr' | 'translation';
  bookId: string;
  dbJobId: string;           // Database job record ID
  submittedAt: string;       // ISO timestamp of batch submission
  attemptCount: number;      // Number of times this monitor has checked
}

/**
 * Payload for book-batch-translation queue
 * Translates pages sequentially ONE AT A TIME with context from previous page
 * Self-re-enqueues every 10 pages to stay within 5min queue timeout
 */
export interface BookBatchTranslationPayload {
  bookId: string;
  dbJobId: string;         // Database job record ID
  pageIds: string[];       // ALL page IDs for this book (sorted by page_number)
  model: string;           // e.g., 'gemini-3-flash-preview'
  sourceLanguage: string;  // e.g., 'Latin'
  targetLanguage: string;  // e.g., 'English'
  startPageIndex?: number; // Internal: for queue timeout management (default 0)
}

/**
 * Response from queue-books endpoint
 */
export interface QueueBooksResponse {
  success: boolean;
  jobIds: string[];        // Database job IDs for tracking
}

/**
 * Request body for queue-books endpoint
 */
export interface QueueBooksRequest {
  bookIds?: string[];      // Specific book IDs to queue (optional if auto: true)
  auto?: boolean;          // Auto-find books needing OCR
  limit?: number;          // Max books to queue (default 10, max 10)
}
