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

// Export the base client
export { apiClient } from './client';

// Export all types (single source of truth)
export * from './types';

// Export all API modules (functions only - types come from ./types)
export * from './likes';
export * from './books';
export * from './jobs';
export * from './batch-jobs';
export * from './catalog';
export * from './gallery';
export * from './pages';
export * from './annotations';
export * from './search';
export * from './highlights';
export * from './prompts';
export * from './experiments';
export * from './import';