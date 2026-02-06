/**
 * Client-safe queue API wrappers
 * These call HTTP endpoints and are safe to import in client components
 *
 * For server-only queue functions that use @vercel/queue, import from './queues.server'
 */

import type {
  QueueBooksRequest,
  QueueBooksResponse
} from './types/queues';
import { apiClient } from './client';

/**
 * Queue pages from a book for background processing
 * Creates a job record and enqueues pages to Lambda workers
 *
 * @param request - Queue request with bookId, pageIds, action, and optional customPrompt
 * @returns Job ID and page count for tracking
 */
export async function queueBooks(request: QueueBooksRequest): Promise<QueueBooksResponse> {
  return await apiClient.post('/api/jobs/queue-books', request);
}