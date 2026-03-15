import { NextRequest, NextResponse } from 'next/server';
import { storagePut } from '@/lib/storage';
import sharp from 'sharp';
import { getDb } from '@/lib/mongodb';
import { images } from '@/lib/api-client/images';
import { compress_photo } from '@/lib/image-manipulation';
import { getPageImageUrl } from '@/lib/utils';
import { withAuth } from '@/lib/auth-helpers';

export const maxDuration = 300;

/**
 * POST /api/books/[id]/generate-thumbnails
 *
 * Pre-generate 150px JPEG thumbnails and store in Vercel Blob.
 * Eliminates the need for on-the-fly sharp resizing via /api/image.
 */
export const POST = withAuth(async (request, session, context) => {
  try {
    const { id: bookId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const {
      limit = 100,
      force = false,
      dryRun = false,
    } = body;

    const db = await getDb();

    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Find pages that need thumbnails
    const query: Record<string, unknown> = { book_id: bookId };
    if (!force) {
      query.thumbnail_blob = { $exists: false };
    }

    const pagesToProcess = await db.collection('pages')
      .find(query)
      .sort({ page_number: 1 })
      .limit(limit)
      .toArray();

    if (pagesToProcess.length === 0) {
      const totalPages = await db.collection('pages').countDocuments({ book_id: bookId });
      const thumbnailedPages = await db.collection('pages').countDocuments({
        book_id: bookId,
        thumbnail_blob: { $exists: true, $ne: null }
      });

      return NextResponse.json({
        message: 'All pages have thumbnails',
        generated: 0,
        totalPages,
        thumbnailedPages,
        percentComplete: totalPages > 0 ? Math.round((thumbnailedPages / totalPages) * 100) : 0
      });
    }

    if (dryRun) {
      const totalNeeding = await db.collection('pages').countDocuments(query);
      return NextResponse.json({
        dryRun: true,
        wouldGenerate: pagesToProcess.length,
        totalNeedingThumbnails: totalNeeding,
        samplePages: pagesToProcess.slice(0, 5).map(p => ({
          id: p.id,
          pageNumber: p.page_number,
          source: p.archived_photo ? 'blob' : p.cropped_photo ? 'cropped' : 'remote'
        }))
      });
    }

    // Process in batches of 10
    const batchSize = 10;
    const results: Array<{
      pageId: string;
      pageNumber: number;
      success: boolean;
      error?: string;
      blobUrl?: string;
    }> = [];

    let totalBytesUploaded = 0;

    for (let i = 0; i < pagesToProcess.length; i += batchSize) {
      const batch = pagesToProcess.slice(i, i + batchSize);

      const batchResults = await Promise.all(
        batch.map(async (page) => {
          try {
            // Determine best source image
            const imageUrl = getPageImageUrl(page as unknown as { photo: string; cropped_photo?: string; archived_photo?: string; photo_original?: string; crop?: unknown });
            if (!imageUrl) {
              return {
                pageId: page.id,
                pageNumber: page.page_number,
                success: false,
                error: 'No image URL available'
              };
            }

            // Fetch the source image
            let buffer: Buffer;
            if (imageUrl.startsWith('/')) {
              // Local path (cropped_photo) — read from filesystem
              const fs = await import('fs/promises');
              const path = await import('path');
              buffer = await fs.readFile(path.join(process.cwd(), 'public', imageUrl));
            } else {
              const result = await images.fetchBufferWithMimeType(imageUrl);
              buffer = result.buffer;
            }

            // Apply crop if the page has crop data and we're NOT using a pre-cropped image
            if (page.crop && !page.cropped_photo) {
              const metadata = await sharp(buffer).metadata();
              const imgWidth = metadata.width || 1000;
              const imgHeight = metadata.height || 1000;

              const left = Math.round((page.crop.xStart / 1000) * imgWidth);
              const cropWidth = Math.round(((page.crop.xEnd - page.crop.xStart) / 1000) * imgWidth);

              buffer = await sharp(buffer)
                .extract({
                  left,
                  top: 0,
                  width: Math.min(cropWidth, imgWidth - left),
                  height: imgHeight,
                })
                .toBuffer();
            }

            // Generate 150px thumbnail
            const thumbBuffer = await compress_photo(buffer, 150, 60);

            // Upload to Vercel Blob
            const filename = `thumbnails/${bookId}/${page.page_number}.jpg`;
            const blob = await storagePut(filename, thumbBuffer, {
              access: 'public',
              contentType: 'image/jpeg',
              addRandomSuffix: false,
              allowOverwrite: true,
            });

            // Update page record
            await db.collection('pages').updateOne(
              { id: page.id },
              {
                $set: {
                  thumbnail_blob: blob.url,
                  updated_at: new Date()
                }
              }
            );

            totalBytesUploaded += thumbBuffer.byteLength;

            return {
              pageId: page.id,
              pageNumber: page.page_number,
              success: true,
              blobUrl: blob.url
            };
          } catch (error) {
            return {
              pageId: page.id,
              pageNumber: page.page_number,
              success: false,
              error: error instanceof Error ? error.message : 'Thumbnail generation failed'
            };
          }
        })
      );

      results.push(...batchResults);

      // Small delay between batches
      if (i + batchSize < pagesToProcess.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    // Get updated counts
    const totalPages = await db.collection('pages').countDocuments({ book_id: bookId });
    const thumbnailedPages = await db.collection('pages').countDocuments({
      book_id: bookId,
      thumbnail_blob: { $exists: true, $ne: null }
    });
    const remainingCount = await db.collection('pages').countDocuments({
      book_id: bookId,
      thumbnail_blob: { $exists: false }
    });

    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;

    return NextResponse.json({
      success: true,
      generated: successCount,
      failed: failedCount,
      remaining: remainingCount,
      totalPages,
      thumbnailedPages,
      percentComplete: Math.round((thumbnailedPages / totalPages) * 100),
      bytesUploaded: totalBytesUploaded,
      results: results.slice(0, 20),
    });

  } catch (error) {
    console.error('Generate thumbnails error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Thumbnail generation failed' },
      { status: 500 }
    );
  }
});

/**
 * GET /api/books/[id]/generate-thumbnails
 *
 * Check thumbnail generation status for a book.
 */
export const GET = withAuth(async (request, session, context) => {
  try {
    const { id: bookId } = await context.params;
    const db = await getDb();

    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const totalPages = await db.collection('pages').countDocuments({ book_id: bookId });
    const thumbnailedPages = await db.collection('pages').countDocuments({
      book_id: bookId,
      thumbnail_blob: { $exists: true, $ne: null }
    });
    const remaining = totalPages - thumbnailedPages;

    return NextResponse.json({
      bookId,
      title: book.title,
      totalPages,
      thumbnailedPages,
      remaining,
      percentComplete: totalPages > 0 ? Math.round((thumbnailedPages / totalPages) * 100) : 0,
    });

  } catch (error) {
    console.error('Error checking thumbnail status:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Check failed' },
      { status: 500 }
    );
  }
});
