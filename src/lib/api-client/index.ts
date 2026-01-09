/**
 * API Client
 *
 * Centralized API client for Source Library.
 * All API calls should go through these client modules instead of using fetch() directly.
 *
 * Usage:
 * ```typescript
 * import { books, pages, search } from '@/lib/api-client';
 * import type { BookSearchResponse, SearchResult } from '@/lib/api-client';
 *
 * Get all books
 * const { books: bookList } = await books.list();
 *
 * Search
 * const results = await search.search('alchemy');
 *
 * OCR a Page
 * await pages.ocr(pageId, { model: 'gemini-2.0-flash' });
 * ```
 */

// Export the base client and streaming utility
export { apiClient, streamRequest } from './client';

// Export all types (single source of truth)
export * from './types';

// Export all API modules (functions only - types come from ./types)
export * from './analytics';
export * from './annotations';
export * from './batch-jobs';
export * from './books';
export * from './catalog';
export * from './categories';
export * from './contribute';
export * from './detections';
export * from './entities';
export * from './experiments';
export * from './gallery';
export * from './highlights';
export * from './images';
export * from './import';
export * from './jobs';
export * from './likes';
export * from './pages';
export * from './processing';
export * from './prompts';
export * from './qa';
export * from './search';
export * from './social';
export * from './split-detection';
export * from './upload';
export * from './utils';