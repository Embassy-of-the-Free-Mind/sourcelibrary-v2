/** Curated highlight entry for a book within a collection */
export interface CuratedHighlight {
  book_id: string;
  rank: number;
  tier: number;
  note: string;
  title?: string;
  author?: string;
  year?: number;
}

/** Gallery/featured image reference */
export interface CollectionImageRef {
  extracted_url?: string;
  thumbnail_url?: string;
  image_url?: string;
}

/** Book collection — curated thematic grouping */
export interface Collection {
  slug: string;
  name: string;
  subtitle: string;
  description: string;
  expanded_description?: string;
  color: 'rust' | 'sage' | 'violet' | 'gold';
  order: number;
  book_count: number;
  parent?: string;
  sample_books: CollectionBookRef[];
  highlighted_books?: CuratedHighlight[];
  mentioned_books?: { text: string; book_id: string }[];
  curated_gallery_images?: CollectionImageRef[];
  featured_images?: CollectionImageRef[];
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
  slug?: string;
  thumbnail?: string;
  thumbnail_blob?: string;
  published?: string;
  read_count?: number;
  is_first_translation?: boolean;
  categories?: string[];
}
