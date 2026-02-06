/**
 * Image Extraction Processor Worker (AWS Lambda Handler)
 *
 * Lambda function that processes individual page image extraction requests from page-image-extraction-queue.
 * Configured with reserved concurrency = 10 for rolling window behavior.
 *
 * This is a thin wrapper around the core logic in image-extraction-processor-logic.ts
 */

import { SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from 'aws-lambda';
import { PageProcessingMessage } from '@/lib/types/sqs';
import { processImageExtractionPage } from './image-extraction-processor-logic';

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const failures: SQSBatchItemFailure[] = [];

  // Process pages from batch (Lambda event source will send batches)
  for (const record of event.Records) {
    try {
      const message: PageProcessingMessage = JSON.parse(record.body);
      await processImageExtractionPage(message);
    } catch (error) {
      console.error('[Lambda-ImageExtraction] Processing failed:', error);
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures: failures };
}
