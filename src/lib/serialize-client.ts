/**
 * Helpers for passing data from Server Components to Client Components.
 * MongoDB documents include ObjectId/_id values that are not plain JSON.
 */

/** Plain gallery row safe to pass into client exhibition components */
export type ClientGalleryImage = {
  id: string;
  book_id: string;
  page_id?: string;
  book_title: string;
  book_author?: string;
  type?: string;
  museum_description?: string;
  gallery_quality?: number;
  extracted_url?: string;
  thumbnail_url?: string;
  image_url?: string;
  /** Legacy camelCase from embedded curated_gallery_images */
  extractedUrl?: string;
  thumbnailUrl?: string;
  imageUrl?: string;
  bookId?: string;
};

export function toClientJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function omitMongoId<T extends Record<string, unknown>>(doc: T): Omit<T, '_id'> {
  const { _id: _ignored, ...rest } = doc;
  return rest as Omit<T, '_id'>;
}

export function galleryImagesForClient(
  images: Record<string, unknown>[],
): ClientGalleryImage[] {
  return toClientJson(images.map(omitMongoId)) as ClientGalleryImage[];
}
