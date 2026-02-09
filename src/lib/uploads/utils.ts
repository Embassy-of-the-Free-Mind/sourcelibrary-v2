/**
 * Shared Upload Utilities
 *
 * Common functions used by both formData and S3 URL upload endpoints:
 * - Book validation
 * - Page number calculation
 * - Book metadata updates
 * - MIME type detection
 */

import type { Db } from 'mongodb';
import type { Book } from '../types/book';
import { selectBestCover } from '@/lib/cover-selection';

/**
 * Get file extension from MIME type
 *
 * @param mimeType - MIME type string (e.g., 'image/jpeg')
 * @returns File extension (e.g., '.jpg')
 */
export function getExtensionFromMimeType(mimeType: string): string {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/gif') return '.gif';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/jp2' || mimeType === 'image/jpx') return '.jp2';
  return '.jpg'; // Default to JPEG
}

/**
 * Detect MIME type from file extension
 * Used when file.type is not available
 *
 * @param filename - Filename or path
 * @returns MIME type string
 */
export function getMimeTypeFromExtension(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'jp2') return 'image/jp2';
  return 'image/jpeg'; // Default
}

export interface ValidateBookResult {
  book: Book;
  nextPageNumber: number;
}

/**
 * Validate that book exists and get next page number
 *
 * @param db - Database instance
 * @param bookId - Book ID to validate
 * @returns Book document and next page number
 * @throws Error if book not found
 */
export async function validateBookAndGetPageNumber(
  db: Db,
  bookId: string
): Promise<ValidateBookResult> {
  // Verify book exists
  const book = await db.collection<Book>('books').findOne({ id: bookId });
  if (!book) {
    throw new Error('Book not found');
  }

  // Get current max page number
  const existingPages = await db.collection('pages')
    .find({ book_id: bookId })
    .sort({ page_number: -1 })
    .limit(1)
    .toArray();

  const nextPageNumber = existingPages.length > 0 ? existingPages[0].page_number + 1 : 1;

  return {
    book,
    nextPageNumber
  };
}

/**
 * Update book metadata after successful upload
 * Recalculates page count from database instead of incrementing
 *
 * @param db - Database instance
 * @param bookId - Book ID to update
 */
export async function updateBookAfterUpload(
  db: Db,
  bookId: string,
  overwriteThumbnail: boolean = false
): Promise<void> {
  // Get book and calculate actual page count
  const book = await db.collection<Book>('books').findOne({ id: bookId });
  const totalPages = await db.collection('pages').countDocuments({ book_id: bookId });

  const updateFields: Record<string, unknown> = {
    updated_at: new Date(),
    pages_count: totalPages
  };

  // Only run cover selection if overwriting OR no thumbnail exists
  if (overwriteThumbnail || !book?.thumbnail) {
    try {
      const coverResult = await selectBestCover(db, bookId);
      updateFields.thumbnail = coverResult.selectedImageUrl;
      updateFields.thumbnail_page = coverResult.pageNumber;
      updateFields.thumbnail_confidence = coverResult.confidence;
    } catch (error) {
      console.error('Cover selection failed, skipping thumbnail update:', error);
      // Don't fail the entire upload - just skip thumbnail
    }
  }

  // Update book with page count and thumbnail
  await db.collection('books').updateOne(
    { id: bookId },
    { $set: updateFields }
  );
}
