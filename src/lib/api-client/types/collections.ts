/** Book collection — curated thematic grouping */
export interface Collection {
  slug: string;
  name: string;
  subtitle: string;
  description: string;
  color: 'rust' | 'sage' | 'violet' | 'gold';
  order: number;
  book_count: number;
  sample_books: CollectionBookRef[];
  languages: { lang: string; count: number }[];
  created_at: string;
  updated_at: string;
}

export interface CollectionBookRef {
  id: string;
  title: string;
  author?: string;
  year?: number;
  photo?: string;
}

export interface CollectionsListResponse {
  collections: Collection[];
}

export interface CollectionDetailResponse {
  collection: Collection;
  books: CollectionBook[];
  total: number;
  limit: number;
  offset: number;
}

export interface CollectionBook {
  id: string;
  title: string;
  display_title?: string;
  author?: string;
  year?: number;
  language?: string;
  pages_count?: number;
  pages_ocr?: number;
  pages_translated?: number;
  photo?: string;
  categories?: string[];
}
