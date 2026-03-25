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
  rotation?: 0 | 90 | 180 | 270;
  extractedUrl?: string;
  thumbnailUrl?: string;
  galleryQuality?: number;
  museumDescription?: string;
  metadata?: ImageMetadata;
  likeCount?: number;
  likedByVisitor?: boolean;
  firstSyncedAt?: string;
}

export interface BookInfo {
  id: string;
  slug?: string;
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
  collection?: string;
  library?: string;
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
  includeArchive?: boolean;
  maxPerBook?: number;
  sort?: string;
  visitorId?: string;
}

export interface GalleryImageUpdateRequest {
  description?: string;
  museumDescription?: string;
  metadata?: ImageMetadata;
  galleryQuality?: number;
  type?: string;
  bbox?: BBox;
  rotation?: 0 | 90 | 180 | 270;
}

export interface GalleryImageUpdateResponse {
  success: boolean;
  item?: GalleryItem;
  updated?: Record<string, unknown>;
  extractedUrl?: string;
  thumbnailUrl?: string;
}

export interface GalleryImageDetail {
  id: string;
  pageId: string;
  detectionIndex: number;
  imageUrl: string;
  fullPageUrl: string;
  highResUrl?: string;
  extractedUrl?: string;
  thumbnailUrl?: string;
  cropUrl?: string | null;
  rotation?: 0 | 90 | 180 | 270;
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
    slug?: string;
    title: string;
    author?: string;
    year?: number;
    doi?: string;
    thumbnail?: string;
  };
  pageNumber: number;
  readUrl: string;
  galleryUrl: string;
  citation: string;
}
