/**
 * Highlights API Types
 * Shared between API client and route handlers
 */

export interface Highlight {
  id: string;
  _id?: string;
  user_id: string;
  book_id: string;
  page_id: string;
  page_number: number;
  text: string;
  note?: string;
  color?: string;
  start_offset: number;
  end_offset: number;
  created_at: Date;
  updated_at?: Date;
}

export interface HighlightCreateRequest {
  book_id: string;
  page_id: string;
  page_number: number;
  text: string;
  note?: string;
  color?: string;
  start_offset: number;
  end_offset: number;
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
