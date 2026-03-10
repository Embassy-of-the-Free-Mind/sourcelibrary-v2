import { SQSClient, SendMessageCommand, SendMessageBatchCommand, GetQueueAttributesCommand, PurgeQueueCommand } from '@aws-sdk/client-sqs';
import type { PageProcessingMessage, PageOcrMessage, WriteResultMessage } from './types/sqs';

// Initialize SQS client
// Use AWS SDK's default credential provider chain:
// - In Vercel: reads AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY from environment
// - In Lambda: automatically uses the Lambda's IAM role credentials
const sqsClient = new SQSClient({
  region: process.env.AWS_REGION || 'eu-central-1',
});

// Queue URLs from environment
export const QUEUE_URLS = {
  pageOcr: process.env.SQS_PAGE_OCR_QUEUE_URL || '',
  pageTranslation: process.env.SQS_PAGE_TRANSLATION_QUEUE_URL || '',
  pageImageExtraction: process.env.SQS_PAGE_IMAGE_EXTRACTION_QUEUE_URL || '',
  writeResults: process.env.SQS_WRITE_RESULTS_QUEUE_URL || '',
};

interface SendMessageOptions {
  queueUrl: string;
  message: PageProcessingMessage;
  messageGroupId?: string; // Required for FIFO queues
  deduplicationId?: string; // Optional for FIFO (content-based if not provided)
}

/**
 * Send a single message to an SQS queue
 */
export async function sendMessage(options: SendMessageOptions) {
  const { queueUrl, message, messageGroupId, deduplicationId } = options;

  const params: any = {
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify(message),
  };

  // Add FIFO-specific parameters if provided
  if (messageGroupId) {
    params.MessageGroupId = messageGroupId;
  }
  if (deduplicationId) {
    params.MessageDeduplicationId = deduplicationId;
  }

  const command = new SendMessageCommand(params);
  const result = await sqsClient.send(command);

  return {
    messageId: result.MessageId,
    sequenceNumber: result.SequenceNumber,
  };
}

interface BatchMessageEntry {
  message: PageProcessingMessage;
  messageGroupId?: string;
  deduplicationId?: string;
}

/**
 * Send multiple messages to an SQS queue in a batch
 * Maximum 10 messages per batch
 */
export async function sendMessageBatch(queueUrl: string, entries: BatchMessageEntry[]) {
  if (entries.length > 10) {
    throw new Error('Maximum 10 messages per batch');
  }

  const batchEntries = entries.map((entry, index) => {
    const params: any = {
      Id: `msg-${index}`,
      MessageBody: JSON.stringify(entry.message),
    };

    if (entry.messageGroupId) {
      params.MessageGroupId = entry.messageGroupId;
    }
    if (entry.deduplicationId) {
      params.MessageDeduplicationId = entry.deduplicationId;
    }

    return params;
  });

  const command = new SendMessageBatchCommand({
    QueueUrl: queueUrl,
    Entries: batchEntries,
  });

  const result = await sqsClient.send(command);

  return {
    successful: result.Successful || [],
    failed: result.Failed || [],
  };
}

/**
 * Helper: Send OCR page message to standard queue
 */
export async function sendPageOcrMessage(message: PageOcrMessage) {
  return sendMessage({
    queueUrl: QUEUE_URLS.pageOcr,
    message,
  });
}

/**
 * Helper: Send multiple OCR page messages in batch
 */
export async function sendPageOcrMessageBatch(messages: PageOcrMessage[]) {
  // Process in chunks of 10 (SQS batch limit)
  const results = [];

  for (let i = 0; i < messages.length; i += 10) {
    const chunk = messages.slice(i, i + 10);
    const entries = chunk.map(message => ({ message }));
    const result = await sendMessageBatch(QUEUE_URLS.pageOcr, entries);
    results.push(result);
  }

  return results;
}

export { sqsClient };

// --- Queue management utilities ---

export interface QueueDepth {
  visible: number;
  inFlight: number;
  total: number;
}

/**
 * Get the approximate message count for an SQS queue.
 * Returns visible + in-flight counts.
 */
export async function getQueueDepth(queueUrl: string): Promise<QueueDepth> {
  const resp = await sqsClient.send(new GetQueueAttributesCommand({
    QueueUrl: queueUrl,
    AttributeNames: [
      'ApproximateNumberOfMessages',
      'ApproximateNumberOfMessagesNotVisible',
    ],
  }));
  const attrs = resp.Attributes || {};
  const visible = parseInt(attrs.ApproximateNumberOfMessages || '0');
  const inFlight = parseInt(attrs.ApproximateNumberOfMessagesNotVisible || '0');
  return { visible, inFlight, total: visible + inFlight };
}

/**
 * Purge all messages from an SQS queue.
 * Note: SQS allows one purge per 60 seconds per queue.
 */
export async function purgeQueue(queueUrl: string): Promise<void> {
  await sqsClient.send(new PurgeQueueCommand({ QueueUrl: queueUrl }));
}

/**
 * Purge all AI worker queues (OCR, Translation, Image Extraction).
 * Does NOT purge the write-results queue — in-flight DB writes should complete.
 */
export async function purgeAIQueues(): Promise<{ purged: string[]; errors: string[] }> {
  const purged: string[] = [];
  const errors: string[] = [];

  const queues = [
    { name: 'ocr', url: QUEUE_URLS.pageOcr },
    { name: 'translation', url: QUEUE_URLS.pageTranslation },
    { name: 'image_extraction', url: QUEUE_URLS.pageImageExtraction },
  ];

  for (const { name, url } of queues) {
    if (!url) {
      errors.push(`${name}: queue URL not configured`);
      continue;
    }
    try {
      await purgeQueue(url);
      purged.push(name);
      console.log(`[SQS] Purged ${name} queue`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${name}: ${msg}`);
      console.error(`[SQS] Failed to purge ${name} queue:`, msg);
    }
  }

  return { purged, errors };
}

/**
 * Send a write result message to the write-results queue.
 * Called by AI workers after Gemini call completes (success or failure).
 * The Writer Lambda consumes these and performs all MongoDB writes.
 *
 * SQS max message size is 256KB. OCR/translation text is typically 1-5KB,
 * so we're well within limits. Log a warning if payload exceeds 200KB.
 */
export async function sendWriteResult(message: WriteResultMessage) {
  const body = JSON.stringify(message);

  if (body.length > 200_000) {
    console.warn(`[SQS] Write result message is ${(body.length / 1024).toFixed(1)}KB (page ${message.pageId}). SQS limit is 256KB.`);
  }

  const command = new SendMessageCommand({
    QueueUrl: QUEUE_URLS.writeResults,
    MessageBody: body,
  });

  const result = await sqsClient.send(command);
  return { messageId: result.MessageId };
}
