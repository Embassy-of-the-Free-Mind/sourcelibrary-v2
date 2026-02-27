/**
 * Write Processor Worker (AWS Lambda Handler)
 *
 * Consumes write-result messages from the results queue and performs
 * all MongoDB writes. Reserved concurrency = 50 caps DB connections.
 *
 * This decouples Gemini API throughput from MongoDB write rate,
 * preventing connection storms during large batch jobs.
 *
 * Thin wrapper around write-processor-logic.ts (same pattern as other workers).
 */

import { SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from 'aws-lambda';
import type { WriteResultMessage } from '@/lib/types/sqs';
import { processWriteResult } from './write-processor-logic';

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  console.log('[Lambda-Writer] Handler started, processing', event.Records.length, 'records');
  const failures: SQSBatchItemFailure[] = [];

  for (const record of event.Records) {
    try {
      const message: WriteResultMessage = JSON.parse(record.body);
      await processWriteResult(message);
    } catch (error) {
      console.error('[Lambda-Writer] Processing failed for record', record.messageId, ':', error);
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures: failures };
}
