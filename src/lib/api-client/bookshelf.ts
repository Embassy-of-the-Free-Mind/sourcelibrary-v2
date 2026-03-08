import { apiClient } from './client';
import type { BookshelfStatus } from '@/lib/types/bookshelf';
import { getVisitorId } from '@/hooks/useIdentity';

export interface BookshelfEntryWithBook {
  book_id: string;
  status: BookshelfStatus;
  last_read_page_id: string | null;
  last_read_page_number: number | null;
  last_read_at: string | null;
  added_at: string;
  updated_at: string;
  book: {
    title: string;
    author?: string;
    year?: number;
    language?: string;
    pages_count?: number;
    pages_translated?: number;
    pages_ocr?: number;
    cover_image: string | null;
  };
}

export const bookshelf = {
  /**
   * List all bookshelf entries for the current visitor
   */
  list: async (): Promise<{ entries: BookshelfEntryWithBook[]; total: number }> => {
    const visitorId = getVisitorId();
    if (!visitorId) return { entries: [], total: 0 };
    return await apiClient.get(`/api/bookshelf?visitor_id=${visitorId}`, {
      headers: { 'X-Visitor-ID': visitorId },
    });
  },

  /**
   * Add a book to the bookshelf
   */
  add: async (bookId: string, status: BookshelfStatus = 'want_to_read'): Promise<{ success: boolean; status: string }> => {
    const visitorId = getVisitorId();
    return await apiClient.post('/api/bookshelf', { book_id: bookId, status }, {
      headers: { 'X-Visitor-ID': visitorId },
    });
  },

  /**
   * Update bookshelf entry
   */
  update: async (bookId: string, data: {
    status?: BookshelfStatus;
    last_read_page_id?: string;
    last_read_page_number?: number;
  }): Promise<{ success: boolean }> => {
    const visitorId = getVisitorId();
    return await apiClient.patch(`/api/bookshelf/${bookId}`, data, {
      headers: { 'X-Visitor-ID': visitorId },
    });
  },

  /**
   * Remove a book from the bookshelf
   */
  remove: async (bookId: string): Promise<{ success: boolean }> => {
    const visitorId = getVisitorId();
    return await apiClient.post(`/api/bookshelf/${bookId}/remove`, {}, {
      headers: { 'X-Visitor-ID': visitorId },
    });
  },

  /**
   * Track reading progress (fire-and-forget)
   */
  trackProgress: (bookId: string, pageId: string, pageNumber: number) => {
    const visitorId = getVisitorId();
    if (!visitorId) return;

    // Debounce: skip if last update was < 5 min ago
    const cacheKey = `sl_progress_${bookId}`;
    const lastUpdate = localStorage.getItem(cacheKey);
    if (lastUpdate && Date.now() - parseInt(lastUpdate) < 5 * 60 * 1000) return;

    localStorage.setItem(cacheKey, Date.now().toString());

    // Fire-and-forget
    fetch(`/api/bookshelf/${bookId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Visitor-ID': visitorId,
      },
      body: JSON.stringify({
        last_read_page_id: pageId,
        last_read_page_number: pageNumber,
      }),
    }).catch(() => {});
  },
};
