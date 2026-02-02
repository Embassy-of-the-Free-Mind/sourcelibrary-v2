/**
 * Server-only queue functions
 * These use @vercel/queue which requires Node.js APIs (fs, etc.)
 * Only import this file in server-side code (API routes, server components)
 */

import { send } from '@vercel/queue';
import type {
  BookBatchOcrPayload,
  BatchMonitorPayload,
  BookBatchTranslationPayload,
} from './types/queues';

/**
 * Calculate adaptive delay for batch monitoring
 * More frequent checks as 48h Gemini result expiry approaches
 *
 * @param elapsedHours - Hours since batch was submitted
 * @returns Delay in milliseconds until next check
 */
export function calculateNextCheckDelay(elapsedHours: number): number {
  // ============================================================
  // TESTING MODE: Check frequently for faster feedback
  // ============================================================
  if (elapsedHours < 12) return 2 * 60 * 1000;   // 2 minutes
  if (elapsedHours < 36) return 2 * 60 * 1000;   // 2 minutes
  if (elapsedHours < 46) return 1 * 60 * 1000;   // 1 minute
  return 30 * 1000;                               // 30 seconds (critical window)

  // ============================================================
  // PRODUCTION MODE: Uncomment below and comment out testing mode above
  // ============================================================
  // if (elapsedHours < 12) return 6 * 60 * 60 * 1000;  // 6 hours
  // if (elapsedHours < 36) return 3 * 60 * 60 * 1000;  // 3 hours
  // if (elapsedHours < 46) return 1 * 60 * 60 * 1000;  // 1 hour
  // return 15 * 60 * 1000;                              // 15 minutes (critical window)
}

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
