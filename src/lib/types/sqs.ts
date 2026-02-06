/**
 * SQS Message Types for Book Processing Queue System
 */

/**
 * Message sent to page processing queues (OCR, Translation, Image Extraction)
 * Single unified interface for all three action types
 */
export interface PageProcessingMessage {
  bookId: string;
  pageId: string;
  jobId: string;
  customPrompt?: string;  // Used for OCR and Translation (not Image Extraction)
}

/**
 * For backward compatibility, keep PageOcrMessage as alias
 */
export type PageOcrMessage = PageProcessingMessage;

/**
 * SQS send options for generic message sending
 */
export interface SQSSendOptions {
  queueUrl: string;
  message: PageProcessingMessage;
  messageGroupId?: string; // Required for FIFO queues
  deduplicationId?: string; // Optional for FIFO (content-based if not provided)
}
