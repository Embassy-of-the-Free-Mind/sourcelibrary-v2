/**
 * Gallery API Types
 * Shared between API client and route handlers
 */
import type { DeepZoomManifest } from '@/lib/types/book';

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
  iconclass?: string[];
  cit?: string[];
}

/** A merged-gallery tile is either an illustration cropped from a book page
 *  ('illustration', the gallery_images default) or a standalone artwork
 *  ('artwork', a content_type:'artwork' record). Defaults to 'illustration'
 *  when absent so existing consumers keep working. */
export type GallerySource = 'illustration' | 'artwork';

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
  /** Which kind of visual this is. Absent ⇒ 'illustration'. */
  source?: GallerySource;
  /** Width÷height of the displayed image, for reserving tile space (no layout
   *  shift on load) and balancing masonry columns. */
  aspect?: number;
  /** Where the tile links to. Illustrations omit this (built from pageId-detectionIndex);
   *  artworks set it to their /book/<slug> detail page. */
  link?: string;
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
  /** Available source facet values for the merged gallery. */
  sources?: GallerySource[];
}

export interface GalleryResponse {
  items: GalleryItem[];
  total: number;
  limit: number;
  offset: number;
  bookInfo: BookInfo | null;
  filters: GalleryFilters;
  /** Reliable "more pages exist" flag (preferred over total-vs-offset math). */
  hasMore?: boolean;
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
  iconclass?: string;
  /** Merged-gallery source filter. 'all' (default) interleaves both. */
  source?: 'all' | GallerySource;
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
  /** Diagnostic info for the materialized gallery_images sync. */
  gallerySync?: 'ok' | 'hidden_low_quality' | 'no_change' | { error: string };
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
  model?: string | null;
  detectionSource?: string | null;
  /** ISO timestamp of the AI extraction run that produced description/metadata. */
  detectedAt?: string | null;
  galleryQuality?: number | null;
  galleryRationale?: string | null;
  featured?: boolean;
  viewCount?: number;
  metadata?: ImageMetadata | null;
  museumDescription?: string | null;
  bbox?: BBox;
  /**
   * DZI tile pyramid for this page's scan, when one exists AND the detection
   * bbox could be placed in its coordinate space (#2714). The two fields travel
   * together: `deepzoom` is deliberately null whenever `focusBbox` is, so a
   * client can never open the viewer without knowing where to point it.
   */
  deepzoom?: DeepZoomManifest | null;
  /** `bbox` translated into the master's coordinate space — split-aware. */
  focusBbox?: BBox | null;
  book: {
    id: string;
    slug?: string;
    title: string;
    author?: string;
    year?: number;
    doi?: string;
    thumbnail?: string;
    thumbnail_blob?: string;
  };
  pageNumber: number;
  readUrl: string;
  galleryUrl: string;
  citation: string;
}
