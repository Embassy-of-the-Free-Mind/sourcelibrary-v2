import { apiClient } from './client';

export interface ReadingHistoryEntry {
  book_id: string;
  first_page_id: string;
  first_page_number: number;
  last_page_id: string;
  last_page_number: number;
  pages_viewed: number;
  started_at: string;
  updated_at: string;
  referrer?: string;
  book: {
    id: string;
    title: string;
    display_title?: string;
    author?: string;
    year?: number;
    language?: string;
    thumbnail?: string;
    slug?: string;
    pages_count?: number;
    pages_translated?: number;
    pages_ocr?: number;
  };
}

export interface ReadingHistoryResponse {
  entries: ReadingHistoryEntry[];
  total: number;
  offset: number;
  limit: number;
}

export const readingHistory = {
  /**
   * Record a page view (fire-and-forget via sendBeacon)
   * Server silently no-ops for anonymous users.
   */
  record: (bookId: string, pageId: string, pageNumber: number, referrer?: string) => {
    if (typeof navigator === 'undefined' || !navigator.sendBeacon) return;

    const payload = JSON.stringify({
      book_id: bookId,
      page_id: pageId,
      page_number: pageNumber,
      ...(referrer ? { referrer } : {}),
    });

    navigator.sendBeacon('/api/reading-history', new Blob([payload], { type: 'application/json' }));
  },

  /**
   * List reading history (requires auth)
   */
  list: async (params?: { limit?: number; offset?: number }): Promise<ReadingHistoryResponse> => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    const query = qs.toString();
    return await apiClient.get(`/api/reading-history${query ? `?${query}` : ''}`);
  },

  /**
   * Clear reading history (one book or all)
   */
  clear: async (bookId?: string): Promise<{ success: boolean; deleted: number }> => {
    return await apiClient.post('/api/reading-history/clear', bookId ? { book_id: bookId } : {});
  },
};
