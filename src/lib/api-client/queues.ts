import { send } from '@vercel/queue';
import type {
  BookBatchOcrPayload,
  BatchMonitorPayload,
  BookBatchTranslationPayload,
  QueueBooksRequest,
  QueueBooksResponse
} from './types/queues';
import { apiClient } from './client';

/**
 * Calculate adaptive delay for batch monitoring
 * More frequent checks as 48h Gemini result expiry approaches
 *
 * @param elapsedHours - Hours since batch was submitted
 * @returns Delay in milliseconds until next check
 */
export function calculateNextCheckDelay(elapsedHours: number): number {
  if (elapsedHours < 12) return 6 * 60 * 60 * 1000;  // 6 hours
  if (elapsedHours < 36) return 3 * 60 * 60 * 1000;  // 3 hours
  if (elapsedHours < 46) return 1 * 60 * 60 * 1000;  // 1 hour
  return 15 * 60 * 1000;                              // 15 minutes (critical window)
}

/**
 * Queue Functions
 * These directly enqueue jobs to Vercel Queues
 */

/**
 * Enqueue a book for OCR processing via Gemini Batch API
 * Book's pages will be chunked into 50-page batches
 */
export async function enqueueBookOcr(payload: BookBatchOcrPayload) {
  return await send('book-batch-ocr', payload);
}

/**
 * Enqueue batch monitoring job
 * Monitors Gemini Batch API job status and downloads results when ready
 *
 * @param payload - Monitor payload
 * @param delayMs - Optional delay before processing (for adaptive scheduling)
 */
export async function enqueueBatchMonitor(
  payload: BatchMonitorPayload,
  delayMs?: number
) {
  const options = delayMs ? { delaySeconds: Math.floor(delayMs / 1000) } : undefined;
  return await send('batch-monitor', payload, options);
}

/**
 * Enqueue a book for translation via real-time Gemini API
 * Translation is sequential with context from previous pages
 */
export async function enqueueBookTranslation(payload: BookBatchTranslationPayload) {
  return await send('book-batch-translation', payload);
}

/**
 * API Endpoint Wrappers
 * These call HTTP endpoints that trigger queue operations
 */

/**
 * Queue multiple books for OCR and translation
 * Creates job records and enqueues books to processing pipeline
 *
 * @param request - Queue request with bookIds or auto: true
 * @returns Job IDs for tracking
 */
export async function queueBooks(request: QueueBooksRequest): Promise<QueueBooksResponse> {
  return await apiClient.post('/api/jobs/queue-books', request);
}