/**
 * Queue Payload Types
 * Shared between queue client and queue handlers
 */

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
