/**
 * gallery-doc.ts — canonical builder for `gallery_images` documents (TS twin).
 *
 * See `scripts/lib/gallery-doc.mjs` for the full rationale. `gallery_images` is
 * written by four paths that drifted apart (#2531); this is the single source
 * of truth for the field set on the TypeScript side (SQS path). Keep in sync
 * with the `.mjs` twin — the guard test `tests/unit/gallery-doc-schema.test.ts`
 * pins the key set across both.
 */
import { coerceImageType } from './gallery-image-types';

/** Minimal page shape needed to build a gallery doc. */
export interface GalleryDocPage {
  id: string;
  book_id?: string;
  page_number?: number | null;
  enhanced_photo?: string | null;
  cropped_photo?: string | null;
  archived_photo?: string | null;
  photo_original?: string | null;
  photo?: string | null;
}

/** Minimal book shape needed to build a gallery doc. */
export interface GalleryDocBook {
  id?: string;
  display_title?: string | null;
  title?: string | null;
  author?: string | null;
  year?: number | string | null;
  language?: string | null;
  visible?: boolean | null;
  hidden?: boolean | null;
  image_source?: { provider?: string | null } | null;
}

/** One detected illustration (subset of `pages.detected_images[]`). */
export interface GalleryDocDetection {
  thumbnail_url?: string | null;
  extracted_url?: string | null;
  description?: string | null;
  type?: string | null;
  bbox?: { x: number; y: number; width: number; height: number };
  rotation?: number | null;
  gallery_quality?: number | null;
  confidence?: number | null;
  gallery_rationale?: string | null;
  museum_description?: string | null;
  detection_source?: string | null;
  model?: string | null;
  detected_at?: Date | null;
  metadata?: Record<string, unknown> | null;
  dhash?: string | null;
}

export interface BuildGalleryDocArgs {
  page: GalleryDocPage;
  book?: GalleryDocBook | null;
  detectedImage: GalleryDocDetection;
  index: number;
  now?: Date;
  galleryQuality?: number;
  bookRank?: number;
  scanQuality?: Record<string, unknown> | null;
  pageImageCharacteristics?: Record<string, unknown> | null;
}

/** Keys every gallery_images doc carries. Mirrors `GALLERY_DOC_KEYS` in the
 *  `.mjs` twin; the guard test asserts both produce exactly this set. */
export const GALLERY_DOC_KEYS = [
  'id',
  'page_id',
  'book_id',
  'page_number',
  'detection_index',
  'image_url',
  'thumbnail_url',
  'extracted_url',
  'description',
  'type',
  'bbox',
  'rotation',
  'gallery_quality',
  'confidence',
  'gallery_rationale',
  'museum_description',
  'detection_source',
  'model',
  'detected_at',
  'metadata',
  'dhash',
  'book_title',
  'book_author',
  'book_year',
  'book_language',
  'book_visible',
  'book_hidden',
  'book_provider',
  'updated_at',
] as const;

export const GALLERY_DOC_OPTIONAL_KEYS = [
  'book_rank',
  'scan_quality',
  'page_image_characteristics',
] as const;

/** Resolve the full-page display image for `image_url` (the source the lens
 *  magnifier crops from — never the pre-cropped `extracted_url`). */
export function galleryImageUrl(page: GalleryDocPage): string {
  return (
    page?.enhanced_photo ||
    page?.cropped_photo ||
    page?.archived_photo ||
    page?.photo_original ||
    page?.photo ||
    ''
  );
}

/** Build a fully-denormalized gallery_images document. See the `.mjs` twin for
 *  the full contract; callers apply the quality gate before calling. */
export function buildGalleryDoc({
  page,
  book,
  detectedImage,
  index,
  now = new Date(),
  galleryQuality,
  bookRank,
  scanQuality,
  pageImageCharacteristics,
}: BuildGalleryDocArgs): Record<string, unknown> {
  const img = detectedImage || ({} as GalleryDocDetection);
  const doc: Record<string, unknown> = {
    id: `${page.id}-${index}`,
    page_id: page.id,
    book_id: book?.id ?? page.book_id,
    page_number: page.page_number ?? null,
    detection_index: index,
    image_url: galleryImageUrl(page),
    thumbnail_url: img.thumbnail_url ?? null,
    extracted_url: img.extracted_url ?? null,
    description: img.description || '',
    // Validated at the write boundary, not trusted from the detector: the model
    // occasionally narrates its enum choice instead of making one, and that
    // narration used to be stored as the value itself (#3419).
    type: coerceImageType(img.type),
    bbox: img.bbox,
    rotation: img.rotation ?? null,
    gallery_quality:
      typeof galleryQuality === 'number' ? galleryQuality : (img.gallery_quality ?? null),
    confidence: img.confidence ?? null,
    gallery_rationale: img.gallery_rationale ?? null,
    museum_description: img.museum_description ?? null,
    detection_source: img.detection_source ?? null,
    model: img.model ?? null,
    detected_at: img.detected_at ?? null,
    metadata: img.metadata ?? null,
    dhash: img.dhash ?? null,
    book_title: book?.display_title || book?.title || 'Unknown',
    book_author: book?.author ?? null,
    book_year: book?.year ?? null,
    book_language: book?.language ?? null,
    book_visible: book?.visible ?? false,
    book_hidden: book?.hidden ?? null,
    book_provider: book?.image_source?.provider ?? null,
    updated_at: now,
  };
  if (typeof bookRank === 'number') doc.book_rank = bookRank;
  if (scanQuality) doc.scan_quality = scanQuality;
  if (pageImageCharacteristics) doc.page_image_characteristics = pageImageCharacteristics;
  return doc;
}
