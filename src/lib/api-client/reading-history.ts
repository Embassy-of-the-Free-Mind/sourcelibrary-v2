import { apiClient } from './client';

export interface ReadingHistoryEntry {
  book_id: string;
  first_page_id: string;
  first_page_number: number;
  last_page_id: string;
  last_page_number: number;
  pages_viewed: number;
  pages_read?: { page_id: string; page_number: number }[];
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
    thumbnail_blob?: string;
    image_display?: string;
    image_thumb?: string;
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

// All routes target the global `/api/reading-history` namespace. The proxy
// attaches a tenant header on tenant subdomains and `/[tenant]/...` paths;
// the global routes also resolve tenant from the book itself when needed,
// so canonical `/book/{slug}` URLs work the same way.
const BASE = '/api/reading-history';

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

    navigator.sendBeacon(BASE, new Blob([payload], { type: 'application/json' }));
  },

  /**
   * List reading history (requires auth)
   */
  list: async (params?: { limit?: number; offset?: number }): Promise<ReadingHistoryResponse> => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    const query = qs.toString();
    return await apiClient.get(`${BASE}${query ? `?${query}` : ''}`);
  },

  /**
   * Clear reading history (one book or all)
   */
  clear: async (bookId?: string): Promise<{ success: boolean; deleted: number }> => {
    return await apiClient.post(`${BASE}/clear`, bookId ? { book_id: bookId } : {});
  },
};
