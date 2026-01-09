/**
 * Entities (Encyclopedia) API types
 */

export interface EntityBook {
  book_id: string;
  book_title: string;
  book_author: string;
  pages: number[];
}

export interface Entity {
  _id?: string;
  name: string;
  type: 'person' | 'place' | 'concept';
  aliases?: string[];
  description?: string;
  wikipedia_url?: string;
  books: EntityBook[];
  total_mentions: number;
  book_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface EntitiesListResponse {
  entities: Entity[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface EntitiesListFilters {
  type?: 'person' | 'place' | 'concept';
  q?: string; // search query
  book_id?: string; // filter by book
  min_books?: number; // minimum number of books (default: 1)
  limit?: number; // max results (default: 50, max: 200)
  offset?: number; // pagination offset
}

export interface EntityResponse extends Entity {
  related?: Array<{
    _id?: string;
    name: string;
    type: 'person' | 'place' | 'concept';
    book_count: number;
  }>;
}

export interface EntityUpdateRequest {
  description?: string;
  aliases?: string[];
  wikipedia_url?: string;
}
