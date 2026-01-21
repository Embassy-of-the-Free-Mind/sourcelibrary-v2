/**
 * Shared Upload Processing Logic
 *
 * Handles the core upload pipeline for both formData and S3 URL uploads:
 * - Upload original to Vercel Blob
 * - Detect if image is two-page spread
 * - Process as split (2 pages) or single (1 page)
 * - Generate thumbnails
 * - Return page records ready for DB insertion
 */

import { put } from '@vercel/blob';
import type { Db } from 'mongodb';
import type { Page } from '../types/page';
import { compress_photo, convertToJpeg } from '../image-manipulation';
import {
  detectSplit,
  processSingleImage,
  processSplitImage
} from '../page-split/split-processing';

export interface ProcessImageUploadParams {
  buffer: Buffer;
  filename: string;
  contentType: string;
  bookId: string;
  nextPageNumber: number;
  db: Db;
}

export interface ProcessImageUploadResult {
  pages: Page[];
  nextPageNumber: number;
}

/**
 * Process image upload with split detection and thumbnail generation
 *
 * This function encapsulates the entire upload pipeline:
 * 1. Upload original image to Vercel Blob
 * 2. Detect if image is a two-page spread
 * 3. If split: crop both halves, upload cropped images and thumbnails
 * 4. If single: generate and upload thumbnail
 * 5. Return page records ready for database insertion
 *
 * @param params - Upload parameters
 * @returns Page records and updated page number
 *
 * @example
 * const result = await processImageUpload({
 *   buffer: imageBuffer,
 *   filename: '507f1f77bcf86cd799439011.jpg',
 *   contentType: 'image/jpeg',
 *   bookId: 'book-123',
 *   nextPageNumber: 5,
 *   db
 * });
 *
 * // Insert pages into database
 * await db.collection('pages').insertMany(result.pages);
 */
export async function processImageUpload(
  params: ProcessImageUploadParams
): Promise<ProcessImageUploadResult> {
  let { buffer, filename, contentType, bookId, nextPageNumber, db } = params;

  // Convert JP2 to JPEG for Gemini API compatibility
  if (contentType === 'image/jp2' || contentType === 'image/jpx') {    
    const converted = await convertToJpeg(buffer, 85, true); // Pass isJp2=true
    buffer = converted.buffer;
    contentType = converted.mimeType;
    // Update filename extension
    filename = filename.replace(/\.jp2$/i, '.jpg');
  }
  
  // STEP 1: Upload original image to Vercel Blob (now JPEG if it was JP2)  
  const originalBlobPath = `uploads/${bookId}/${filename}`;
  const originalBlob = await put(originalBlobPath, buffer, {
    access: 'public',
    contentType,
    addRandomSuffix: false
  });

  // STEP 2: Detect if this is a two-page spread
  const splitResult = await detectSplit(buffer, originalBlob.url, db);

  // STEP 3a: Process as split image (creates 2 pages with separate thumbnails)
  if (splitResult.isTwoPageSpread) {
    try {
      const [leftPage, rightPage] = await processSplitImage(
        buffer,
        bookId,
        nextPageNumber,
        originalBlob.url,
        splitResult
      );

      return {
        pages: [leftPage, rightPage],
        nextPageNumber: nextPageNumber + 2
      };
    } catch (splitError) {
      console.error(`Split processing failed for ${filename}, falling back to single page:`, splitError);
      // Fall through to single page logic
    }
  }

  // STEP 3b: Process as single page (either not a spread or split failed)
  // Generate thumbnail from original buffer
  const thumbnailBuffer = await compress_photo(buffer, 150, 60);
  const thumbnailBlobPath = `uploads/${bookId}/thumbnails/${filename}`;
  const thumbnailBlob = await put(thumbnailBlobPath, thumbnailBuffer, {
    access: 'public',
    contentType,
    addRandomSuffix: false
  });

  const singlePage = await processSingleImage(
    bookId,
    nextPageNumber,
    originalBlob.url,
    thumbnailBlob.url
  );

  return {
    pages: [singlePage],
    nextPageNumber: nextPageNumber + 1
  };
}
