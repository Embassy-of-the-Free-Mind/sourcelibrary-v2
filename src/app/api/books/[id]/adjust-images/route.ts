import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { getDb } from '@/lib/mongodb';
import { images } from '@/lib/api-client/images';
import { adjustBrightness, compress_photo } from '@/lib/image-manipulation';
import { logAuditEvent } from '@/lib/audit-logger';

export const maxDuration = 300;

/**
 * POST /api/books/[id]/adjust-images
 *
 * Adjust brightness of selected page images and re-upload to Vercel Blob.
 * Downloads the current archived/original image, applies brightness adjustment
 * via sharp, and overwrites the archived image on Blob.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const body = await request.json();
    const { pageIds, brightness } = body as { pageIds: string[]; brightness: number };

    if (!pageIds || !Array.isArray(pageIds) || pageIds.length === 0) {
      return NextResponse.json({ error: 'pageIds required' }, { status: 400 });
    }
    if (typeof brightness !== 'number' || brightness <= 0 || brightness > 3) {
      return NextResponse.json({ error: 'brightness must be between 0 and 3' }, { status: 400 });
    }

    const db = await getDb();

    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Fetch the target pages
    const pagesToProcess = await db.collection('pages')
      .find({ id: { $in: pageIds }, book_id: bookId })
      .sort({ page_number: 1 })
      .toArray();

    if (pagesToProcess.length === 0) {
      return NextResponse.json({ error: 'No matching pages found' }, { status: 404 });
    }

    const batchSize = 5;
    const results: Array<{
      pageId: string;
      pageNumber: number;
      success: boolean;
      error?: string;
    }> = [];

    for (let i = 0; i < pagesToProcess.length; i += batchSize) {
      const batch = pagesToProcess.slice(i, i + batchSize);

      const batchResults = await Promise.all(
        batch.map(async (page) => {
          // Image fallback chain: archived_photo > photo_original > photo
          const sourceUrl = page.archived_photo || page.photo_original || page.photo;
          if (!sourceUrl) {
            return { pageId: page.id, pageNumber: page.page_number, success: false, error: 'No image URL' };
          }

          try {
            // Download current image
            const { buffer } = await images.fetchBufferWithMimeType(sourceUrl);

            // Apply brightness adjustment
            const adjustedBuffer = await adjustBrightness(buffer, brightness);

            // Upload adjusted image to Vercel Blob (overwrite)
            const filename = `archived/${bookId}/${page.page_number}.jpg`;
            const blob = await put(filename, adjustedBuffer, {
              access: 'public',
              contentType: 'image/jpeg',
              addRandomSuffix: false,
              allowOverwrite: true,
            });

            // Regenerate 150px thumbnail
            let thumbnailUrl: string | undefined;
            try {
              const thumbBuffer = await compress_photo(adjustedBuffer, 150, 60);
              const thumbFilename = `thumbnails/${bookId}/${page.page_number}.jpg`;
              const thumbBlob = await put(thumbFilename, thumbBuffer, {
                access: 'public',
                contentType: 'image/jpeg',
                addRandomSuffix: false,
                allowOverwrite: true,
              });
              thumbnailUrl = thumbBlob.url;
            } catch {
              // Non-fatal
            }

            // Update page record
            const updateFields: Record<string, unknown> = {
              archived_photo: blob.url,
              'archive_metadata.brightness': brightness,
              'archive_metadata.brightness_adjusted_at': new Date(),
              updated_at: new Date(),
            };
            if (thumbnailUrl) {
              updateFields.thumbnail_blob = thumbnailUrl;
            }

            await db.collection('pages').updateOne(
              { id: page.id },
              { $set: updateFields }
            );

            return { pageId: page.id, pageNumber: page.page_number, success: true };
          } catch (error) {
            return {
              pageId: page.id,
              pageNumber: page.page_number,
              success: false,
              error: error instanceof Error ? error.message : 'Adjustment failed',
            };
          }
        })
      );

      results.push(...batchResults);

      // Delay between batches
      if (i + batchSize < pagesToProcess.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;

    // Audit log
    logAuditEvent({
      action: 'images_brightness_adjusted',
      book_id: bookId,
      book_title: book.title,
      pages_affected: successCount,
      metadata: { brightness, failed: failedCount },
    });

    return NextResponse.json({
      success: true,
      adjusted: successCount,
      failed: failedCount,
      brightness,
      results,
    });
  } catch (error) {
    console.error('Adjust images error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Adjustment failed' },
      { status: 500 }
    );
  }
}
