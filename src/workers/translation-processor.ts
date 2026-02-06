/**
 * Translation Processor Worker (AWS Lambda Handler)
 *
 * Lambda function that processes individual page translation requests from page-translation-queue.
 * FIFO queue ensures sequential processing per job for context continuity.
 *
 * This is a thin wrapper around the core logic in translation-processor-logic.ts
 */

import { SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from 'aws-lambda';
import { PageProcessingMessage } from '@/lib/types/sqs';
import { processTranslationPage } from './translation-processor-logic';

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const failures: SQSBatchItemFailure[] = [];

  // Process pages from batch (Lambda event source will send batches)
  for (const record of event.Records) {
    try {
      const message: PageProcessingMessage = JSON.parse(record.body);
      await processTranslationPage(message);
    } catch (error) {
      console.error('[Lambda-Translation] Processing failed:', error);
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures: failures };
}
