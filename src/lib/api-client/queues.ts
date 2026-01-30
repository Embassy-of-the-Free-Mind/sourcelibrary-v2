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
 * Queue multiple books for OCR and translation
 * Creates job records and enqueues books to processing pipeline
 *
 * @param request - Queue request with bookIds or auto: true
 * @returns Job IDs for tracking
 */
export async function queueBooks(request: QueueBooksRequest): Promise<QueueBooksResponse> {
  return await apiClient.post('/api/jobs/queue-books', request);
}