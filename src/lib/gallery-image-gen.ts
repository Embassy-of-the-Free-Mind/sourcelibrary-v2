/**
 * Gallery Image Generation
 *
 * Generates pre-cropped, rotated gallery images and thumbnails,
 * then uploads them to Vercel Blob for fast gallery rendering.
 *
 * Replaces on-the-fly /api/crop-image calls with pre-generated Blob URLs.
 */

import sharp from 'sharp';
import { put } from '@vercel/blob';
import { images } from '@/lib/api-client/images';

interface GenerateGalleryImagesInput {
  sourceImageUrl: string;
  bbox: { x: number; y: number; width: number; height: number };
  rotation?: 0 | 90 | 180 | 270;
  bookId: string;
  pageId: string;
  detectionIndex: number;
}

interface GenerateGalleryImagesResult {
  extractedUrl: string;   // Full-size cropped+rotated JPEG
  thumbnailUrl: string;   // 300px thumbnail JPEG
}

/**
 * Generate cropped+rotated gallery image and thumbnail, upload to Vercel Blob.
 *
 * Pipeline: fetch source → sharp extract (bbox + padding) → rotate → JPEG → upload
 * Also generates a 300px-wide thumbnail for the gallery grid.
 */
export async function generateGalleryImages(
  input: GenerateGalleryImagesInput
): Promise<GenerateGalleryImagesResult> {
  const { sourceImageUrl, bbox, rotation = 0, bookId, pageId, detectionIndex } = input;

  // Fetch source image
  const imageBuffer = await images.fetchBuffer(sourceImageUrl);

  // Get image dimensions
  const metadata = await sharp(imageBuffer).metadata();
  const imgWidth = metadata.width || 1;
  const imgHeight = metadata.height || 1;

  // Apply padding (2% of image size) and compute pixel coordinates
  const padding = 0.02;
  const padX = padding * imgWidth;
  const padY = padding * imgHeight;

  const left = Math.max(0, Math.floor(bbox.x * imgWidth - padX));
  const top = Math.max(0, Math.floor(bbox.y * imgHeight - padY));
  const width = Math.min(imgWidth - left, Math.ceil(bbox.width * imgWidth + padX * 2));
  const height = Math.min(imgHeight - top, Math.ceil(bbox.height * imgHeight + padY * 2));

  // Extract (crop) the region
  let pipeline = sharp(imageBuffer).extract({ left, top, width, height });

  // Apply rotation if specified
  if (rotation) {
    pipeline = pipeline.rotate(rotation);
  }

  // Generate full-size extracted image (JPEG 85)
  const extractedBuffer = await pipeline
    .jpeg({ quality: 85, progressive: true })
    .toBuffer();

  // Generate 300px thumbnail (JPEG 70)
  const thumbnailBuffer = await sharp(extractedBuffer)
    .resize(300, null, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 70 })
    .toBuffer();

  // Upload both to Vercel Blob
  const blobPrefix = `gallery/${bookId}/${pageId}-${detectionIndex}`;

  const [extractedBlob, thumbnailBlob] = await Promise.all([
    put(`${blobPrefix}.jpg`, extractedBuffer, {
      access: 'public',
      contentType: 'image/jpeg',
      addRandomSuffix: false,
    }),
    put(`${blobPrefix}-thumb.jpg`, thumbnailBuffer, {
      access: 'public',
      contentType: 'image/jpeg',
      addRandomSuffix: false,
    }),
  ]);

  return {
    extractedUrl: extractedBlob.url,
    thumbnailUrl: thumbnailBlob.url,
  };
}
