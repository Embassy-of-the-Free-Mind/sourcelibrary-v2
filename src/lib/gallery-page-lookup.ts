/**
 * The "page + its book" aggregate behind a gallery image view (#5184).
 *
 * PRIOR ART: none — searched src/lib for `$lookup` + `books` helpers and the
 * four gallery sites each inlined the same three-stage pipeline with no
 * `$project`, so every gallery page view shipped the FULL page doc (ocr,
 * translations, thumbnails) plus the FULL book doc (editions, index…), three
 * times over (layout gate + layout data + opengraph image), and once more for
 * the API the viewer calls.
 *
 * Field lists are the union of what the four callers read (#4603 starvation
 * check, per site):
 *  - src/app/gallery/image/[id]/layout.tsx — `imageResolves` (book.hidden,
 *    detected_images), `getImageData` → generateMetadata + ImageLayout +
 *    GalleryImageSchema (book id/slug/title/display_title/author/published/
 *    image_source.{license,attribution,provider}/license; page id/book_id/
 *    page_number/detected_images/enhanced_photo/cropped_photo/archived_photo/
 *    photo).
 *  - src/app/gallery/image/[id]/opengraph-image.tsx — detected_images and
 *    `getPageImageUrl(page)` (the image-field family).
 *  - src/app/api/gallery/image/[id]/route.ts — the above plus deepzoom,
 *    fullres_master, `remapBboxToMaster` (crop, cropped_photo, image_width,
 *    image_height, split_from_spread), `allmapsEditorUrl` (photo_original,
 *    book.ia_identifier, book.image_source.iiif_manifest), the response's
 *    book block (doi, thumbnail) and `resolveHoldingCopy(book)`
 *    (contributing_library, shelfmark + image_source twins).
 *
 * `image_source` is included whole: it is small (~0.8 KB avg) and read through
 * four different sub-paths.
 */

import type { Document } from 'mongodb';

export const GALLERY_PAGE_PROJECTION: Record<string, 1> = {
  id: 1, book_id: 1, tenantId: 1, page_number: 1, page_type: 1,
  detected_images: 1, deepzoom: 1, fullres_master: 1,
  photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, display_photo: 1,
  enhanced_photo: 1, thumbnail: 1, thumbnail_blob: 1, image_thumb: 1,
  crop: 1, split_from_spread: 1, split_from: 1, image_width: 1, image_height: 1,
};

export const GALLERY_BOOK_PROJECTION: Record<string, 0 | 1> = {
  _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1, published: 1,
  hidden: 1, visible: 1, doi: 1, thumbnail: 1, ia_identifier: 1, image_source: 1,
  license: 1, contributing_library: 1, shelfmark: 1,
};

/**
 * `[$match, $lookup books → book, $unwind]` with both sides projected. The
 * `$lookup` uses the concise correlated form (localField/foreignField plus a
 * sub-pipeline, MongoDB ≥ 5.0) so the `books.id` index still serves the join.
 */
export function galleryPageWithBookPipeline(match: Document): Document[] {
  return [
    { $match: match },
    { $project: GALLERY_PAGE_PROJECTION },
    {
      $lookup: {
        from: 'books',
        localField: 'book_id',
        foreignField: 'id',
        pipeline: [{ $project: GALLERY_BOOK_PROJECTION }],
        as: 'book',
      },
    },
    { $unwind: { path: '$book', preserveNullAndEmptyArrays: true } },
  ];
}
