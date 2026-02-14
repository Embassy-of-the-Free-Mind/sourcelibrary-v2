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

export interface ImportFromBodleianRequest {
  uuid: string;
  title: string;
  author: string;
  display_title?: string;
  language?: string;
  published?: string;
  categories?: string[];
}

export interface ImportFromCambridgeRequest {
  ms_id: string;
  title: string;
  author: string;
  display_title?: string;
  language?: string;
  published?: string;
  categories?: string[];
}

export interface ImportFromHABRequest {
  hab_id: string;
  manifest_url?: string;
  title: string;
  author: string;
  display_title?: string;
  language?: string;
  published?: string;
  categories?: string[];
}

export interface ImportFromVaticanRequest {
  mss_id: string;
  title: string;
  author: string;
  display_title?: string;
  language?: string;
  published?: string;
  categories?: string[];
}

export interface ImportFromGoogleBooksRequest {
  google_books_id: string;
  title: string;
  author: string;
  display_title?: string;
  language?: string;
  published?: string;
  categories?: string[];
}

export interface ImportFromEuropeanaRequest {
  record_id: string;
  title: string;
  author: string;
  display_title?: string;
  language?: string;
  published?: string;
  categories?: string[];
  manifest_url?: string;
}

export interface ImportResponse {
  book_id: string;
  book: Book;
  pages_imported: number;
  message: string;
}
