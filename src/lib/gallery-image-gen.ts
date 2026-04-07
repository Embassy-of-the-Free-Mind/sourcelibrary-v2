/**
 * Gallery Image Generation
 *
 * Generates pre-cropped, rotated gallery images and thumbnails,
 * then uploads them to R2 for fast gallery rendering.
 *
 * Replaces on-the-fly /api/crop-image calls with pre-generated R2 URLs.
 */

import sharp from 'sharp';
import { storagePut } from '@/lib/storage';
import { images } from '@/lib/api-client/images';

const GALLERY_IIIF_WIDTH = 4000; // Request high-res from IIIF sources

/**
 * Upgrade an IIIF URL to request a higher-resolution image.
 * Handles /full/1000,/ and /full/pct:50/ and /full/max/ styles.
 */
function upgradeIiifUrl(url: string, width: number): string {
  if (!url.includes('/full/')) return url;
  return url.replace(/\/full\/(full|max|\d+,|pct:\d+)\//, `/full/${width},/`);
}

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
  extractedWidth: number; // Pixel width of extracted image
  extractedHeight: number; // Pixel height of extracted image
}

/**
 * Generate cropped+rotated gallery image and thumbnail, upload to R2.
 *
 * Pipeline: fetch source → sharp extract (bbox + padding) → rotate → JPEG → upload
 * Also generates a 300px-wide thumbnail for the gallery grid.
 */
export async function generateGalleryImages(
  input: GenerateGalleryImagesInput
): Promise<GenerateGalleryImagesResult> {
  const { sourceImageUrl, bbox, rotation = 0, bookId, pageId, detectionIndex } = input;

  // Try IIIF high-res first, fall back to original URL
  const isIiif = sourceImageUrl.includes('/full/') || sourceImageUrl.includes('/iiif/');
  let rawBuffer: Buffer;
  if (isIiif) {
    const hiresUrl = upgradeIiifUrl(sourceImageUrl, GALLERY_IIIF_WIDTH);
    try {
      rawBuffer = await images.fetchBuffer(hiresUrl, { timeout: 30000 });
    } catch {
      // IIIF upgrade failed (404, timeout, etc.) — fall back to original
      rawBuffer = await images.fetchBuffer(sourceImageUrl);
    }
  } else {
    rawBuffer = await images.fetchBuffer(sourceImageUrl);
  }

  // Get original dimensions for bbox normalization
  const rawMeta = await sharp(rawBuffer).metadata();
  const origWidth = rawMeta.width || 1;
  const origHeight = rawMeta.height || 1;

  // Normalize bbox: detect pixel-value coordinates (> 1) and convert to 0-1 range.
  // AI models sometimes return 0-1000 scale instead of 0-1. Use the same heuristic as
  // the UI editor: divide by max(x+w, y+h, 1000) so both 0-1000 and raw-pixel cases work.
  const isPixels = bbox.x > 1 || bbox.y > 1 || bbox.width > 1 || bbox.height > 1;
  let normX: number, normY: number, normW: number, normH: number;
  if (isPixels) {
    const scale = Math.max(bbox.x + bbox.width, bbox.y + bbox.height, 1000);
    normX = Math.min(bbox.x / scale, 0.95);
    normY = Math.min(bbox.y / scale, 0.95);
    normW = Math.min(bbox.width / scale, 1);
    normH = Math.min(bbox.height / scale, 1);
  } else {
    normX = bbox.x;
    normY = bbox.y;
    normW = bbox.width;
    normH = bbox.height;
  }

  // Downscale oversized images before cropping to avoid memory/timeout issues
  // Max 4000px on longest side — matches hires endpoint quality
  const MAX_DIM = 4000;
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
  // Ensure a minimum display size of 800px on the longest side — if the source is
  // low-res and the crop region is small, the extracted image can be tiny (e.g. 300px).
  // Upscaling with Lanczos produces acceptable results and prevents blurry gallery cards.
  const MIN_GALLERY_DIM = 800;
  const croppedBuffer = await pipeline.toBuffer();
  const croppedMeta = await sharp(croppedBuffer).metadata();
  const croppedW = croppedMeta.width || 1;
  const croppedH = croppedMeta.height || 1;

  let extractedBuffer: Buffer;
  if (Math.max(croppedW, croppedH) < MIN_GALLERY_DIM) {
    // Upscale so longest side hits MIN_GALLERY_DIM
    extractedBuffer = await sharp(croppedBuffer)
      .resize(MIN_GALLERY_DIM, MIN_GALLERY_DIM, { fit: 'inside', withoutEnlargement: false, kernel: 'lanczos3' })
      .jpeg({ quality: 85, progressive: true })
      .toBuffer();
  } else {
    extractedBuffer = await sharp(croppedBuffer)
      .jpeg({ quality: 85, progressive: true })
      .toBuffer();
  }

  // Get pixel dimensions of the extracted crop
  const extractedMeta = await sharp(extractedBuffer).metadata();
  const extractedWidth = extractedMeta.width || 0;
  const extractedHeight = extractedMeta.height || 0;

  // Generate 300px thumbnail (JPEG 70)
  const thumbnailBuffer = await sharp(extractedBuffer)
    .resize(300, null, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 70 })
    .toBuffer();

  // Upload both to R2
  const blobPrefix = `gallery/${bookId}/${pageId}-${detectionIndex}`;

  const [extractedBlob, thumbnailBlob] = await Promise.all([
    storagePut(`${blobPrefix}.jpg`, extractedBuffer, {
      contentType: 'image/jpeg',
      allowOverwrite: true,
    }),
    storagePut(`${blobPrefix}-thumb.jpg`, thumbnailBuffer, {
      contentType: 'image/jpeg',
      allowOverwrite: true,
    }),
  ]);

  // Append cache-busting param so CDN/browser don't serve stale crops after bbox edits
  const cacheBust = `?v=${Date.now()}`;

  return {
    extractedUrl: extractedBlob.url + cacheBust,
    thumbnailUrl: thumbnailBlob.url + cacheBust,
    extractedWidth,
    extractedHeight,
  };
}
