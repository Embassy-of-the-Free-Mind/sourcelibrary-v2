import { apiClient, streamRequest } from './client';
import { upload } from './upload';

import type { Book } from '@/lib/types';
import type {
  BooksListResponse,
  BookWithPages,
  BookSearchResponse,
  BookStatusResponse,
  BookCategorizeRequest,
  BookCategorizeResponse,
  BatchTranslateRequest,
  BatchTranslateResponse,
  BatchOcrRequest,
  BatchOcrResponse,
  BookReimportRequest,
  BookReimportResponse,
  BookPagesResponse,
  BookQARequest,
  BookQAResponse,
  BookIdentifyRequest,
  BookIdentifyResponse,
  BookArchiveImagesRequest,
  BookArchiveImagesResponse,
  BookDownloadFormats,
  RoadmapResponse,
} from './types/books';

/**
 * Books API client
 * Handles all book-related operations
 */
export const books = {
  /**
   * Get all books
   */
  list: async (): Promise<BooksListResponse> => {
    return await apiClient.get('/api/books');
  },

  /**
   * Get a single book by ID
   * @param id - Book ID
   * @param options - Optional query parameters
   * @param options.full - Include full OCR/translation data and pages array (default: false)
   */
  get: async (id: string, options?: { full?: boolean }): Promise<Book | BookWithPages> => {
    const query = options?.full ? '?full=true' : '';
    return await apiClient.get(`/api/books/${id}${query}`);
  },

  /**
   * Create a new book
   */
  create: async (book: Partial<Book>): Promise<Book> => {
    return await apiClient.post('/api/books', book);
  },

  /**
   * Update a book
   */
  update: async (id: string, updates: Partial<Book>): Promise<Book> => {
    return await apiClient.patch(`/api/books/${id}`, updates);
  },

  /**
   * Delete a book (soft delete)
   */
  delete: async (id: string): Promise<{ success: boolean }> => {
    return await apiClient.delete(`/api/books/${id}`);
  },

  /**
   * Get roadmap (books pending processing)
   */
  getRoadmap: async (): Promise<RoadmapResponse> => {
    return await apiClient.get('/api/roadmap');
  },

  /**
   * Search books
   */
  search: async (query: string, filters?: Record<string, string>): Promise<BookSearchResponse> => {
    const params = new URLSearchParams({ q: query, ...filters });
    return await apiClient.get(`/api/books/search?${params}`);
  },

  /**
   * Get book status statistics
   */
  status: async (): Promise<BookStatusResponse> => {
    return await apiClient.get('/api/books/status');
  },

  /**
   * Categorize books (add/remove/set categories)
   */
  categorize: async (request: BookCategorizeRequest): Promise<BookCategorizeResponse> => {
    return await apiClient.post('/api/books/categorize', request);
  },

  /**
   * Get deleted books
   */
  deleted: async (): Promise<BooksListResponse> => {
    return await apiClient.get('/api/books/deleted');
  },

  /**
   * Restore a deleted book
   */
  restore: async (id: string): Promise<Book> => {
    return await apiClient.post(`/api/books/restore/${id}`);
  },

  /**
   * Get book pages
   */
  pages: async (id: string): Promise<BookPagesResponse> => {
    return await apiClient.get(`/api/books/${id}/pages`);
  },

  /**
   * Batch translate book pages
   */
  batchTranslate: async (id: string, request: BatchTranslateRequest): Promise<BatchTranslateResponse> => {
    return await apiClient.post(`/api/books/${id}/batch-translate`, request);
  },

  /**
   * Batch OCR book pages (async with Gemini Batch API)
   */
  batchOcrAsync: async (id: string, request: BatchOcrRequest): Promise<BatchOcrResponse> => {
    return await apiClient.post(`/api/books/${id}/batch-ocr-async`, request);
  },

  /**
   * Batch translate book pages (async with Gemini Batch API)
   */
  batchTranslateAsync: async (id: string, request: BatchTranslateRequest): Promise<BatchTranslateResponse> => {
    return await apiClient.post(`/api/books/${id}/batch-translate-async`, request);
  },

  /**
   * Batch OCR book pages
   */
  batchOcr: async (id: string, request: BatchOcrRequest): Promise<BatchOcrResponse> => {
    return await apiClient.post(`/api/books/${id}/batch-ocr`, request);
  },

  /**
   * Reimport book from source (IA, Gallica, etc.)
   */
  reimport: async (id: string, request: BookReimportRequest): Promise<BookReimportResponse> => {
    return await apiClient.post(`/api/books/${id}/reimport`, request);
  },

  /**
   * Reset book (clear OCR and translations)
   */
  reset: async (id: string): Promise<{ success: boolean }> => {
    return await apiClient.post(`/api/books/${id}/reset`);
  },

  /**
   * Reset OCR only
   */
  resetOcr: async (id: string): Promise<{ success: boolean }> => {
    return await apiClient.post(`/api/books/${id}/reset-ocr`);
  },

  /**
   * Clear OCR from all pages
   */
  clearOcr: async (id: string): Promise<{ success: boolean }> => {
    return await apiClient.post(`/api/books/${id}/clear-ocr`);
  },

  /**
   * Generate book summary
   */
  summarize: async (id: string): Promise<{ summary: string }> => {
    return await apiClient.post(`/api/books/${id}/summarize`);
  },

  /**
   * QA audit a book (checks for translation/OCR formatting issues)
   */
  qa: async (id: string): Promise<BookQAResponse> => {
    return await apiClient.get(`/api/books/${id}/qa`);
  },

  /**
   * Identify book in USTC catalog
   */
  identify: async (id: string, request: BookIdentifyRequest): Promise<BookIdentifyResponse> => {
    return await apiClient.post(`/api/books/${id}/identify`, request);
  },

  /**
   * Check if book needs split detection
   */
  checkNeedsSplit: async (id: string): Promise<{ needs_splitting: boolean | null; confidence: string; reasoning: string }> => {
    return await apiClient.post(`/api/books/${id}/check-needs-split`);
  },

  /**
   * Auto-split book pages using ML
   */
  autoSplitMl: async (id: string): Promise<{ job_id: string }> => {
    return await apiClient.post(`/api/books/${id}/auto-split-ml`);
  },

  /**
   * Archive images to Vercel Blob
   */
  archiveImages: async (id: string, request: BookArchiveImagesRequest): Promise<BookArchiveImagesResponse> => {
    return await apiClient.post(`/api/books/${id}/archive-images`, request);
  },

  /**
   * Extract chapters from book
   */
  extractChapters: async (id: string): Promise<{ chapters: Array<{ title: string; pageNumber: number; level: number }> }> => {
    return await apiClient.post(`/api/books/${id}/extract-chapters`);
  },

  /**
   * Search within a book
   */
  searchInBook: async (id: string, query: string): Promise<{ results: Array<{ pageId: string; pageNumber: number; snippet: string }> }> => {
    return await apiClient.get(`/api/books/${id}/search?q=${encodeURIComponent(query)}`);
  },

  /**
   * Download book as file
   */
  download: async (id: string, format: BookDownloadFormats, edition_id?: string): Promise<Response> => {
    const params = new URLSearchParams({format});
    if (edition_id) {
      params.append('edition_id', edition_id);
    }
    
    return await streamRequest(`/api/books/${id}/download?${params.toString()}`,
      { method: 'GET' }
    );
  },

  /**
   * Cleanup empty tags from book translations/OCR
   */
  cleanup: async (id: string, options?: {
    field?: 'translation' | 'ocr' | 'both';
    dryRun?: boolean;
  }): Promise<{
    success: boolean;
    totalTagsRemoved: number;
    pagesModified: number;
    results: Array<{
      pageId: string;
      pageNumber: number;
      field: 'translation' | 'ocr';
      removedCount: number;
    }>;
  }> => {
    return await apiClient.post(`/api/books/${id}/cleanup`, options || {});
  },

  /**
   * Fix book data issues
   */
  fix: async (id: string): Promise<{ success: boolean; fixed: string[] }> => {
    return await apiClient.post(`/api/books/${id}/fix`);
  },

  /**
   * Reorder book pages
   */
  reorder: async (id: string, pageIds: string[]): Promise<{ success: boolean }> => {
    return await apiClient.post(`/api/books/${id}/reorder`, { page_ids: pageIds });
  },

  /**
   * Get book sections
   */
  sections: {
    list: async (id: string): Promise<{ sections: Array<any> }> => {
      return await apiClient.get(`/api/books/${id}/sections`);
    },

    summarize: async (id: string): Promise<{ sections: Array<any> }> => {
      return await apiClient.post(`/api/books/${id}/sections/summarize`);
    },
  },

  /**
   * Book index operations
   */
  index: {
    generate: async (id: string): Promise<{ success: boolean }> => {
      return await apiClient.post(`/api/books/${id}/index`);
    },

    get: async (id: string): Promise<any> => {
      return await apiClient.get(`/api/books/${id}/index`);
    },
  },

  /**
   * Book editions
   */
  editions: {
    list: async (id: string): Promise<{ editions: Array<any> }> => {
      return await apiClient.get(`/api/books/${id}/editions`);
    },

    create: async (id: string, edition: any): Promise<any> => {
      return await apiClient.post(`/api/books/${id}/editions`, edition);
    },

    get: async (id: string, editionId: string): Promise<any> => {
      return await apiClient.get(`/api/books/${id}/editions/${editionId}`);
    },

    update: async (id: string, editionId: string, updates: any): Promise<any> => {
      return await apiClient.patch(`/api/books/${id}/editions/${editionId}`, updates);
    },

    /**
     * Update edition fields (DOI, etc.) via PATCH /api/books/[id]/editions
     * This is different from the update method above which uses the editionId in the path
     */
    updateFields: async (id: string, editionId: string, fields: { doi?: string; doi_url?: string }): Promise<any> => {
      return await apiClient.patch(`/api/books/${id}/editions`, { edition_id: editionId, ...fields });
    },

    delete: async (id: string, editionId: string): Promise<{ success: boolean }> => {
      return await apiClient.delete(`/api/books/${id}/editions/${editionId}`);
    },

    generateFrontMatter: async (id: string): Promise<any> => {
      return await apiClient.post(`/api/books/${id}/editions/front-matter`);
    },

    mintDoi: async (id: string, editionId: string): Promise<{ doi: string; doi_url?: string; zenodo_id?: string; zenodo_url?: string }> => {
      return await apiClient.post(`/api/books/${id}/editions/mint-doi`, { edition_id: editionId });
    },
  },

  /**
   * Book chat/question answering
   */
  chat: {
    history: async (id: string): Promise<any> => {
      return await apiClient.get(`/api/books/${id}/chat`);
    },

    send: async (id: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<{ message: { role: 'assistant'; content: string } }> => {
      return await apiClient.post(`/api/books/${id}/chat`, { messages });
    },
  },

  /**
   * Get a quote from the book
   */
  quote: async (id: string): Promise<{ quote: string; page: number; context: string }> => {
    return await apiClient.get(`/api/books/${id}/quote`);
  },

  /**
   * Stitch translations together
   */
  stitchTranslations: async (id: string): Promise<{ success: boolean; stitched_count: number }> => {
    return await apiClient.post(`/api/books/${id}/stitch-translations`);
  },

  /**
   * Import batch of pages
   */
  importBatch: async (id: string, pages: Array<{ page_number: number; photo: string }>): Promise<{ imported: number }> => {
    return await apiClient.post(`/api/books/${id}/import-batch`, { pages });
  },

  /**
   * Upload multiple image files to a book
   */
  uploadPages: async (bookId: string, files: File[]): Promise<{ pages: Array<{ id: string; page_number: number; photo: string }> }> => {    
    const response = await upload.images(bookId=bookId, files=files);
    return { pages: response.pages };
  },

  /**
   * Pipeline operations (automated processing)
   */
  pipeline: {
    get: async (id: string): Promise<any> => {
      return await apiClient.get(`/api/books/${id}/pipeline`);
    },

    start: async (id: string, config: any): Promise<{ job_id: string }> => {
      return await apiClient.post(`/api/books/${id}/pipeline`, config);
    },

    step: async (id: string, step: string): Promise<any> => {
      return await apiClient.post(`/api/books/${id}/pipeline/step`, { step });
    },

    process: async (id: string): Promise<any> => {
      return await apiClient.post(`/api/books/${id}/pipeline-stream/process`);
    },
  },

  /**
   * Streaming pipeline operations (Server-Sent Events)
   */
  pipelineStream: {
    /**
     * Get pipeline status
     */
    get: async (id: string): Promise<Response> => {
      return await streamRequest(`/api/books/${id}/pipeline-stream`, {
        method: 'GET',
      });
    },

    /**
     * Start pipeline with streaming progress updates
     */
    start: async (id: string, config: any): Promise<Response> => {
      return await streamRequest(`/api/books/${id}/pipeline-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
    },

    /**
     * Process pipeline with streaming updates
     */
    process: async (id: string, config?: any): Promise<Response> => {
      return await streamRequest(`/api/books/${id}/pipeline-stream/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config || {}),
      });
    },

    /**
     * Cancel pipeline
     */
    cancel: async (id: string): Promise<Response> => {
      return await streamRequest(`/api/books/${id}/pipeline-stream`, {
        method: 'DELETE',
      });
    },
  },
};
