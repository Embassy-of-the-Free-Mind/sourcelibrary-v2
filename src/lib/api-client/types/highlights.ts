/**
 * Highlights API Types
 * Shared between API client and route handlers
 */

export interface Highlight {
  id: string;
  book_id: string;
  book_title: string;
  book_author?: string;
  page_id: string;
  page_number: number;
  text: string;
  context?: string;
  note?: string;
  color?: string;
  user_name?: string;
  created_at: Date;
  updated_at?: Date;
}

export interface HighlightCreateRequest {
  book_id: string;
  book_title: string;
  book_author?: string;
  page_id: string;
  page_number: number;
  text: string;
  user_name?: string;
}

export interface HighlightUpdateRequest {
  text?: string;
  note?: string;
  color?: string;
}

export interface HighlightListParams {
  book_id?: string;
  page_id?: string;
  user_id?: string;
  limit?: number;
  offset?: number;
}

export interface HighlightListResponse {
  highlights: Highlight[];
  total: number;
  limit: number;
  offset: number;
}
