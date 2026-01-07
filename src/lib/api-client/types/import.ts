/**
 * Import API Types
 * Shared between API client and route handlers
 */
import type { Book } from '@/lib/types';

export interface ImportFromIARequest {
  ia_identifier: string;
  title: string;
  author: string;
  year?: number;
  original_language?: string;
}

export interface ImportFromGallicaRequest {
  ark: string;
  title: string;
  author: string;
  year?: number;
  original_language?: string;
}

export interface ImportFromMDZRequest {
  bsb_id: string;
  title: string;
  author: string;
  year?: number;
  original_language?: string;
}

export interface ImportResponse {
  book_id: string;
  book: Book;
  pages_imported: number;
  message: string;
}
