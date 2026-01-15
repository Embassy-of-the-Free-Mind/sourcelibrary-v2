import { apiClient } from './client';
import type { QASampleResponse } from './types/qa';

/**
 * QA API client
 * Handles quality assurance sampling and auditing
 */
export const qa = {
  /**
   * Sample pages for QA audit
   *
   * @param n - Sample size (max 200)
   * @param options - Optional filters (model, bookId)
   * @returns QA sample with statistics and confidence intervals
   */
  sample: async (n: number, options?: { model?: string; bookId?: string }): Promise<QASampleResponse> => {
    const params = new URLSearchParams({ n: n.toString() });
    if (options?.model) params.append('model', options.model);
    if (options?.bookId) params.append('book_id', options.bookId);

    return await apiClient.get(`/api/qa/sample?${params.toString()}`);
  },
};
