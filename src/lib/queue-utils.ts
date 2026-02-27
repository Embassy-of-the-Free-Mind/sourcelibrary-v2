/**
 * Shared queueing utilities for job processing
 */

import { createHash } from 'crypto';
import { sendMessageBatch, QUEUE_URLS } from './sqs-client';
import type { JobType } from './types/job';

/** Generate a deduplication ID for SQS FIFO queues (max 128 chars) */
function deduplicationId(bookId: string, pageId: string, jobId: string): string {
  return createHash('sha256').update(`${bookId}:${pageId}:${jobId}`).digest('hex').slice(0, 128);
}

/**
 * Enqueue pages for processing
 * @param bookId - Book ID
 * @param pageIds - Array of page IDs to process
 * @param action - Action type (ocr, translation, image_extraction)
 * @param jobId - Job ID for tracking
 * @param customPrompt - Optional custom prompt for OCR/translation
 */
export async function enqueuePagesForJob(
  bookId: string,
  pageIds: string[],
  action: JobType,
  jobId: string,
  customPrompt?: string
) {
  const queueUrl = action === 'ocr'
    ? QUEUE_URLS.pageOcr
    : action === 'translation'
      ? QUEUE_URLS.pageTranslation
      : QUEUE_URLS.pageImageExtraction;

  // Debug: Check queue URL
  if (!queueUrl) {
    throw new Error(`Queue URL not configured for action: ${action}`);
  }

  const messages = pageIds.map(pageId => ({
    bookId,
    pageId,
    jobId,
    ...(customPrompt && { customPrompt })
  }));

  // Send in batches of 10 (SQS limit)
  for (let i = 0; i < messages.length; i += 10) {
    const batch = messages.slice(i, i + 10);

    try {
      // For FIFO queue (translation), add messageGroupId
      let result;
      if (action === 'translation') {
        const fifoEntries = batch.map(msg => ({
          message: msg,
          messageGroupId: jobId,  // Ensures pages for same job process sequentially
          deduplicationId: deduplicationId(msg.bookId, msg.pageId, msg.jobId),
        }));
        result = await sendMessageBatch(queueUrl, fifoEntries);
      } else {
        // Standard queues (OCR, image extraction)
        result = await sendMessageBatch(queueUrl, batch.map(msg => ({ message: msg })));
      }

      if (result.failed.length > 0) {
        console.error(`[queue-utils] ${result.failed.length} messages failed in batch ${i / 10 + 1}:`, result.failed);
        throw new Error(`SQS batch send had ${result.failed.length} failures out of ${batch.length}`);
      }      
    } catch (error) {
      console.error(`[queue-utils] Failed to send batch ${i / 10 + 1}:`, error);
      throw error;
    }
  }
}
