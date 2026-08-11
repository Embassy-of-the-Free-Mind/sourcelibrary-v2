/**
 * gallery-doc.mjs — canonical builder for `gallery_images` documents.
 *
 * `gallery_images` is a flat, fully-denormalized materialization of each
 * detected illustration (one doc per detection). It has historically been
 * written by FOUR paths that drifted apart (issue #2531,
 * `lesson_gallery_images_provenance_sync`):
 *   - scripts/workers/image-extract-worker.mjs   (Hetzner realtime worker)
 *   - src/workers/image-extraction-processor-logic.ts  (SQS path)
 *   - scripts/workers/sync-worker.mjs            (Mongo aggregation sweep)
 *   - src/app/api/admin/sync-gallery-images      (Mongo aggregation, admin)
 *
 * Each had a slightly different field set, so a freshly-extracted image was
 * often INVISIBLE on the gallery read path (which requires `book_visible:true`
 * + `image_url`) until a separate sync ran. This module is the single source
 * of truth for the field set so it can't drift again.
 *
 * TS twin: `src/lib/gallery-doc.ts` (keep the two in sync — the guard test
 * `tests/unit/gallery-doc-schema.test.ts` pins the key set across both).
 *
 * The two Mongo-aggregation writers can't call this JS function (they build
 * docs server-side via `$project`); they must mirror `GALLERY_DOC_KEYS`.
 */
import { coerceImageType } from './gallery-image-types.mjs';

/** Resolve the full-page display image for the gallery doc's `image_url`.
 *  This is the image the on-the-fly magnifier lens crops from, so it must be
 *  the page-display source — NOT the pre-cropped `extracted_url`. Mirrors the
 *  `$ifNull` chain used by the admin sync route / SQS path. */
export function galleryImageUrl(page) {
  return (
    page?.enhanced_photo ||
    page?.cropped_photo ||
    page?.archived_photo ||
    page?.photo_original ||
    page?.photo ||
    ''
  );
}

/** Keys every gallery_images doc carries (book_rank / scan_quality /
 *  page_image_characteristics are conditional and listed separately). The
 *  guard test asserts each writer produces exactly this set. */
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
];

/** Conditional keys: present only when the caller supplies the data. */
export const GALLERY_DOC_OPTIONAL_KEYS = [
  'book_rank',
  'scan_quality',
  'page_image_characteristics',
];

/**
 * Build a fully-denormalized gallery_images document from a page, its book, and
 * one detected image. Callers stay responsible for the gallery-quality gate
 * (>= 0.5) and any scan-quality adjustment BEFORE calling this — pass the final
 * quality via `galleryQuality` so the doc reflects what was actually filtered.
 *
 * @param {object}  p
 * @param {object}  p.page          page doc (needs id, book_id, page_number, photo fields)
 * @param {object}  p.book          book doc (display_title/title/author/year/language/visible/hidden/image_source)
 * @param {object}  p.detectedImage one entry from page.detected_images
 * @param {number}  p.index         detection index within the page (== detected_images position)
 * @param {Date}    [p.now]         timestamp for updated_at
 * @param {number}  [p.galleryQuality]  final (possibly scan-adjusted) quality; defaults to detectedImage.gallery_quality
 * @param {number}  [p.bookRank]    1-based rank within book by quality; omitted if not provided
 * @param {object}  [p.scanQuality] page-inherited scan_quality block for this image
 * @param {object}  [p.pageImageCharacteristics]  page-level image characteristics summary
 * @returns {object} gallery_images doc
 */
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
}) {
  const img = detectedImage || {};
  const doc = {
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
    gallery_quality: typeof galleryQuality === 'number' ? galleryQuality : (img.gallery_quality ?? null),
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
  // book_rank is cross-page (computed within a book); only the writers that
  // rank set it. Omit otherwise so a per-page upsert never clobbers a rank
  // written by the dedicated rank pass.
  if (typeof bookRank === 'number') doc.book_rank = bookRank;
  if (scanQuality) doc.scan_quality = scanQuality;
  if (pageImageCharacteristics) doc.page_image_characteristics = pageImageCharacteristics;
  return doc;
}
