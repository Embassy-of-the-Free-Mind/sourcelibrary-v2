/**
 * SQS Message Types for Book Processing Queue System
 */

/**
 * Message sent to book-processing-queue.fifo
 * Orchestrates OCR and translation phases for a book
 */
export interface BookProcessingMessage {
  bookId: string;
  dbJobId: string;
  phase?: 'ocr' | 'translation';
  startPageIndex?: number; // For checkpointing (OCR enqueueing or translation)
  retryPageIds?: string[]; // For retry logic - specific pages to reprocess
}

/**
 * Message sent to page-ocr-queue
 * Processes OCR for a single page
 */
export interface PageOcrMessage {
  bookId: string;
  pageId: string;
  dbJobId: string;
  // No batchId needed - jobId is sufficient for tracking
}

/**
 * SQS send options for generic message sending
 */
export interface SQSSendOptions {
  queueUrl: string;
  message: BookProcessingMessage | PageOcrMessage;
  messageGroupId?: string; // Required for FIFO queues
  deduplicationId?: string; // Optional for FIFO (content-based if not provided)
}
