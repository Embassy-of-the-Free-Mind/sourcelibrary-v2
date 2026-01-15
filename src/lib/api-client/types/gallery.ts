/**
 * Gallery API Types
 * Shared between API client and route handlers
 */

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageMetadata {
  subjects?: string[];
  figures?: string[];
  symbols?: string[];
  style?: string;
  technique?: string;
}

export interface GalleryItem {
  pageId: string;
  bookId: string;
  pageNumber: number;
  detectionIndex: number;
  imageUrl: string;
  bookTitle: string;
  author?: string;
  year?: number;
  description: string;
  type?: string;
  bbox?: BBox;
  galleryQuality?: number;
  museumDescription?: string;
  metadata?: ImageMetadata;
}

export interface BookInfo {
  id: string;
  title: string;
  author?: string;
  year?: number;
  pagesCount?: number;
  hasOcr: boolean;
  ocrPageCount: number;
  hasImages: boolean;
  imagesPageCount: number;
}

export interface GalleryFilters {
  types: string[];
  subjects: string[];
  figures: string[];
  symbols: string[];
  yearRange: { minYear: number | null; maxYear: number | null };
}

export interface GalleryResponse {
  items: GalleryItem[];
  total: number;
  limit: number;
  offset: number;
  bookInfo: BookInfo | null;
  filters: GalleryFilters;
}

export interface GallerySearchParams {
  bookId?: string;
  query?: string;
  type?: string;
  subject?: string;
  figure?: string;
  symbol?: string;
  yearFrom?: number;
  yearTo?: number;
  limit?: number;
  offset?: number;
  minQuality?: number;
}

export interface GalleryImageUpdateRequest {
  description?: string;
  museumDescription?: string;
  metadata?: ImageMetadata;
  galleryQuality?: number;
  type?: string;
  bbox?: BBox;
}

export interface GalleryImageUpdateResponse {
  success: boolean;
  item: GalleryItem;
}

export interface GalleryImageDetail {
  id: string;
  pageId: string;
  detectionIndex: number;
  imageUrl: string;
  fullPageUrl: string;
  highResUrl?: string;
  description: string;
  type?: string;
  confidence?: number;
  model?: string;
  detectionSource?: string;
  galleryQuality?: number | null;
  galleryRationale?: string | null;
  featured?: boolean;
  metadata?: ImageMetadata | null;
  museumDescription?: string | null;
  bbox?: BBox;
  book: {
    id: string;
    title: string;
    author?: string;
    year?: number;
    doi?: string;
  };
  pageNumber: number;
  readUrl: string;
  galleryUrl: string;
  citation: string;
}
