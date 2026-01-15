/**
 * Book API Types
 * Shared between API client and route handlers
 */
import type { Book, Page } from '@/lib/types';

export interface BooksListResponse {
  books: Book[];
  total?: number;
}

export interface BookWithPages extends Book {
  pages: Page[];
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
  mode?: 'full' | 'soft' | 'metadata_only';
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
  total?: number;
}

export interface BookQARequest {
  page_limit?: number;
  translation_sample_size?: number;
}

export interface BookQAResponse {
  bookId: string;
  bookTitle: string;
  totalPages: number;
  translatedPages: number;
  pagesWithIssues: number;
  totalIssues: number;
  issues: Array<{
    pageId: string;
    pageNumber: number;
    field: 'translation' | 'ocr';
    issues: Array<{
      type: 'unclosed_open' | 'unclosed_close' | 'unknown_tag' | 'empty_tag' | 'nested_bracket' | 'unbalanced_center' | 'unclosed_xml' | 'unknown_xml_tag' | 'empty_xml_tag';
      message: string;
      position: number;
      length: number;
      context: string;
      suggestedFix?: {
        type: 'insert' | 'delete' | 'replace';
        position: number;
        text?: string;
        length?: number;
      };
    }>;
  }>;
}

export interface BookIdentifyRequest {
  title?: string;
  author?: string;
  year?: string;
}

export interface CatalogMatch {
  id: string;
  title: string;
  author?: string;
  year?: string;
  place?: string;
  source: string;
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
  identified?: {
    title?: string;
    title_english?: string;
    author?: string;
    year?: string;
    place?: string;
    publisher?: string;
    language?: string;
  };
  catalog_matches?: CatalogMatch[];
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

export interface RoadmapResponse {
  total: number;
  in_database: number;
  pending: number;
  books: Array<{
    title: string;
    display_title: string;
    author: string;
    language: string;
    ia_identifier: string;
    source_url: string;
    categories: string[];
    priority: number;
    notes: string;
    in_database: boolean;
  }>;
}

export type BookDownloadFormats =
  'translation' |
  'ocr' |
  'both' |
  'epub-translation' |
  'epub-ocr' |
  'epub-both' |
  'epub-parallel' |
  'epub-facsimile' |
  'epub-images' |
  'images-zip'
