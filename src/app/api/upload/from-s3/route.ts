import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { images } from '@/lib/api-client/images';
import { processImageUpload } from '@/lib/uploads/processing';
import { validateS3Url } from '@/lib/uploads/validation';
import {
  validateBookAndGetPageNumber,
  getExtensionFromMimeType
} from '@/lib/uploads/utils';

// Maximum file size: 20MB (same as formData upload)
const MAX_FILE_SIZE_MEGABYTES = 20 * 1024 * 1024;

/**
 * Upload images from S3 URLs to a book
 *
 * POST /api/upload/from-s3
 * Body: {
 *   bookId: string;
 *   imageUrls: string[];  // Array of S3 URLs
 * }
 *
 * Security:
 * - Only accepts HTTPS URLs from ALLOWED_S3_DOMAIN environment variable
 * - Validates URL format and domain before fetching
 * - Enforces 20MB size limit
 * - 30 second timeout per image
 * - Skips invalid/failed URLs without blocking batch
 *
 * Supports image formats: JPEG, PNG, GIF, WebP, JP2
 *
 * Example:
 * ```bash
 * curl -X POST http://localhost:3000/api/upload/from-s3 \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "bookId": "book-123",
 *     "imageUrls": [
 *       "https://my-bucket.s3.amazonaws.com/image1.jpg",
 *       "https://my-bucket.s3.amazonaws.com/image2.jp2"
 *     ]
 *   }'
 * ```
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { bookId, imageUrls } = body;

    // Validate required fields
    if (!bookId) {
      return NextResponse.json({ error: 'Book ID is required' }, { status: 400 });
    }

    if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
      return NextResponse.json(
        { error: 'imageUrls must be a non-empty array' },
        { status: 400 }
      );
    }

    // Verify book exists and get next page number
    const db = await getDb();
    let nextPageNumber: number;
    try {
      const result = await validateBookAndGetPageNumber(db, bookId);
      nextPageNumber = result.nextPageNumber;
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Book not found' },
        { status: 404 }
      );
    }

    const uploadedPages = [];
    const errors: Array<{ url: string; error: string }> = [];

    for (const imageUrl of imageUrls) {
      try {
        // SECURITY: Validate URL before fetching
        const validation = validateS3Url(imageUrl);
        if (!validation.valid) {
          console.error(`Invalid S3 URL: ${validation.error}`);
          errors.push({ url: imageUrl, error: validation.error || 'Invalid URL' });
          continue; // Skip invalid URLs
        }

        // Fetch image from S3 with timeout
        const { buffer, mimeType } = await images.fetchBufferWithMimeType(imageUrl, {
          timeout: 30000
        });

        // Validate size (same 20MB limit as formData)
        if (buffer.length > MAX_FILE_SIZE_MEGABYTES) {
          const errorMsg = `Image too large: ${buffer.length} bytes (max ${MAX_FILE_SIZE_MEGABYTES})`;
          console.error(errorMsg);
          errors.push({ url: imageUrl, error: errorMsg });
          continue;
        }

        // Generate filename with appropriate extension
        const ext = getExtensionFromMimeType(mimeType);
        const filename = `${new ObjectId().toHexString()}${ext}`;

        // Use shared upload processing function
        const result = await processImageUpload({
          buffer,
          filename,
          contentType: mimeType,
          bookId,
          nextPageNumber,
          db
        });

        // Insert pages into database
        await db.collection('pages').insertMany(result.pages);
        uploadedPages.push(...result.pages);
        nextPageNumber = result.nextPageNumber;

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Upload failed';
        console.error(`Failed to process ${imageUrl}:`, errorMsg);
        errors.push({ url: imageUrl, error: errorMsg });
        // Skip this image, continue with rest
        continue;
      }
    }

    return NextResponse.json({
      success: true,
      uploaded: uploadedPages.length,
      pages: uploadedPages,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('S3 upload error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 500 }
    );
  }
}
