/**
 * Book API Types
 * Shared between API client and route handlers
 */
import type { Book } from '@/lib/types';

export interface BooksListResponse {
  books: Book[];
  total?: number;
}

export interface BookSearchResponse {
  books: Book[];
  total: number;
}

export interface BookStatusResponse {
  total: number;
  by_status: Record<string, number>;
  by_language: Record<string, number>;
  total_pages: number;
  total_translated: number;
  total_ocr: number;
}

export interface BookCategorizeRequest {
  book_ids: string[];
  categories: string[];
  operation: 'add' | 'remove' | 'set';
}

export interface BookCategorizeResponse {
  updated: number;
  failed: number;
  errors?: Array<{ book_id: string; error: string }>;
}

export interface BatchTranslateRequest {
  mode?: 'missing' | 'all';
  model?: string;
  prompt_id?: string;
  page_ids?: string[];
  use_batch_api?: boolean;
}

export interface BatchTranslateResponse {
  job_id: string;
  message: string;
}

export interface BatchOcrRequest {
  mode?: 'missing' | 'all';
  model?: string;
  prompt_id?: string;
  page_ids?: string[];
  use_batch_api?: boolean;
}

export interface BatchOcrResponse {
  job_id: string;
  message: string;
}

export interface BookReimportRequest {
  mode?: 'full' | 'metadata_only';
}

export interface BookReimportResponse {
  success: boolean;
  message: string;
  pages_added?: number;
}

export interface BookPagesResponse {
  pages: Array<{
    id: string;
    page_number: number;
    ocr?: string;
    translation?: string;
    photo?: string;
    photo_original?: string;
  }>;
}

export interface BookQARequest {
  page_limit?: number;
  translation_sample_size?: number;
}

export interface BookQAResponse {
  book: Book;
  sample_pages: Array<{
    id: string;
    page_number: number;
    ocr?: string;
    translation?: string;
    issues?: string[];
  }>;
  translation_quality: {
    sample_size: number;
    quality_score: number;
    issues: string[];
  };
  metadata_accuracy: {
    title_match: boolean;
    author_match: boolean;
    year_match: boolean;
    issues: string[];
  };
}

export interface BookIdentifyRequest {
  title?: string;
  author?: string;
  year?: string;
}

export interface BookIdentifyResponse {
  ustc_matches: Array<{
    ustc_id: string;
    title: string;
    author: string;
    year: string;
    publisher?: string;
    place?: string;
    confidence: number;
  }>;
  suggested_update?: Partial<Book>;
}

export interface BookArchiveImagesRequest {
  limit?: number;
}

export interface BookArchiveImagesResponse {
  archived: number;
  failed: number;
  already_archived: number;
  total_bytes: number;
}
