/**
 * OCR Processor Worker (AWS Lambda Handler)
 *
 * Lambda function that processes individual page OCR requests from page-ocr-queue.
 * Configured with reserved concurrency = 10 for rolling window behavior.
 *
 * This is a thin wrapper around the core logic in ocr-processor-logic.ts
 */

import { SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from 'aws-lambda';
import { PageOcrMessage } from '@/lib/types/sqs';
import { processOcrPage } from './ocr-processor-logic';

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  console.log('[Lambda-OCR] Handler started, processing', event.Records.length, 'records');
  const failures: SQSBatchItemFailure[] = [];

  // Process pages from batch (Lambda event source will send batches)
  for (const record of event.Records) {
    console.log('[Lambda-OCR] Processing record:', record.messageId);
    try {
      const message: PageOcrMessage = JSON.parse(record.body);
      await processOcrPage(message);
    } catch (error) {
      console.error('[Lambda-OCR] Processing failed:', error);
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures: failures };
}