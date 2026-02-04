import { SQSClient, SendMessageCommand, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import type { BookProcessingMessage, PageOcrMessage } from './types/sqs';

// Initialize SQS client
const sqsClient = new SQSClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

// Queue URLs from environment
export const QUEUE_URLS = {
  bookProcessing: process.env.SQS_BOOK_PROCESSING_QUEUE_URL || '',
  pageOcr: process.env.SQS_PAGE_OCR_QUEUE_URL || '',
};

interface SendMessageOptions {
  queueUrl: string;
  message: BookProcessingMessage | PageOcrMessage;
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
  message: BookProcessingMessage | PageOcrMessage;
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
 * Helper: Send book processing message to FIFO queue
 */
export async function sendBookProcessingMessage(message: BookProcessingMessage) {
  return sendMessage({
    queueUrl: QUEUE_URLS.bookProcessing,
    message,
    messageGroupId: message.bookId, // Use bookId as group ID for FIFO ordering
  });
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
