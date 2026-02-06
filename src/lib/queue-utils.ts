/**
 * Shared queueing utilities for job processing
 */

import { sendMessageBatch, QUEUE_URLS } from './sqs-client';
import type { JobType } from './types/job';

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

  const messages = pageIds.map(pageId => ({
    bookId,
    pageId,
    jobId,
    ...(customPrompt && { customPrompt })
  }));

  // Send in batches of 10 (SQS limit)
  for (let i = 0; i < messages.length; i += 10) {
    const batch = messages.slice(i, i + 10);

    // For FIFO queue (translation), add messageGroupId
    if (action === 'translation') {
      const fifoEntries = batch.map(msg => ({
        message: msg,
        messageGroupId: jobId  // Ensures pages for same job process sequentially
      }));
      await sendMessageBatch(queueUrl, fifoEntries);
    } else {
      // Standard queues (OCR, image extraction)
      await sendMessageBatch(queueUrl, batch.map(msg => ({ message: msg })));
    }
  }
}
