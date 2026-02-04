/**
 * Book Processor Worker (AWS Lambda Handler)
 *
 * Lambda function that orchestrates OCR and translation phases for a book.
 * Handles:
 * - OCR Phase: Enqueues pages to page-ocr-queue (50 at a time with checkpoints)
 * - Translation Phase: Processes pages sequentially with context (10 at a time)
 * - Completion: Marks job as completed or partial
 *
 * This is a thin wrapper around the core logic in book-processor-logic.ts
 */

import { SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from 'aws-lambda';
import { BookProcessingMessage } from '@/lib/types/sqs';
import { processBook } from './book-processor-logic';

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const failures: SQSBatchItemFailure[] = [];

  for (const record of event.Records) {
    try {
      const message: BookProcessingMessage = JSON.parse(record.body);
      await processBook(message);
    } catch (error) {
      console.error('[Lambda-Book] Processing failed:', error);
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures: failures };
}
