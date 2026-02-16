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
  const rawBuffer = await images.fetchBuffer(sourceImageUrl);

  // Get original dimensions for bbox normalization
  const rawMeta = await sharp(rawBuffer).metadata();
  const origWidth = rawMeta.width || 1;
  const origHeight = rawMeta.height || 1;

  // Normalize bbox: detect pixel-value coordinates (> 1) and convert to 0-1 range
  const isPixels = bbox.x > 1 || bbox.y > 1 || bbox.width > 1 || bbox.height > 1;
  const normX = isPixels ? bbox.x / origWidth : bbox.x;
  const normY = isPixels ? bbox.y / origHeight : bbox.y;
  const normW = isPixels ? bbox.width / origWidth : bbox.width;
  const normH = isPixels ? bbox.height / origHeight : bbox.height;

  // Downscale oversized images before cropping to avoid memory/timeout issues
  // Max 3000px on longest side — plenty for gallery quality
  const MAX_DIM = 3000;
  let imageBuffer = rawBuffer;
  let imgWidth = origWidth;
  let imgHeight = origHeight;

  if (origWidth > MAX_DIM || origHeight > MAX_DIM) {
    const resized = sharp(rawBuffer)
      .resize(MAX_DIM, MAX_DIM, { fit: 'inside', withoutEnlargement: true });
    imageBuffer = await resized.toBuffer();
    const resizedMeta = await sharp(imageBuffer).metadata();
    imgWidth = resizedMeta.width || 1;
    imgHeight = resizedMeta.height || 1;
  }

  // Apply padding (2% of image size) and compute pixel coordinates
  const padding = 0.02;
  const padX = padding * imgWidth;
  const padY = padding * imgHeight;

  const left = Math.max(0, Math.floor(normX * imgWidth - padX));
  const top = Math.max(0, Math.floor(normY * imgHeight - padY));
  const width = Math.min(imgWidth - left, Math.ceil(normW * imgWidth + padX * 2));
  const height = Math.min(imgHeight - top, Math.ceil(normH * imgHeight + padY * 2));

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

  // Append cache-busting param so CDN/browser don't serve stale crops after bbox edits
  const cacheBust = `?v=${Date.now()}`;

  return {
    extractedUrl: extractedBlob.url + cacheBust,
    thumbnailUrl: thumbnailBlob.url + cacheBust,
  };
}
