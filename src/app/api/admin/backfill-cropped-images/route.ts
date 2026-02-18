import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { images } from '@/lib/api-client';
import { cropAndUploadHalf, generateAndUploadThumbnail } from '@/lib/page-split/split-processing';
import { withAuth } from '@/lib/auth-helpers';

export const maxDuration = 300;

/**
 * Find all pages with crop data but no cropped_photo and generate them.
 *
 * GET - Preview: returns count and sample of pages needing cropped images
 * POST - Execute: generates cropped images + thumbnails inline
 */

export const GET = withAuth(async (request, session) => {
  try {
    const { searchParams } = new URL(request.url);
    const bookId = searchParams.get('bookId');

    const db = await getDb();

    // Find pages with crop data but no cropped_photo
    const query: Record<string, unknown> = {
      'crop.xStart': { $exists: true },
      $or: [
        { cropped_photo: { $exists: false } },
        { cropped_photo: null },
        { cropped_photo: '' }
      ]
    };

    if (bookId) {
      query.book_id = bookId;
    }

    const pages = await db.collection('pages')
      .find(query)
      .project({ id: 1, book_id: 1, page_number: 1, crop: 1, photo_original: 1, photo: 1 })
      .toArray();

    // Group by book
    const byBook: Record<string, number> = {};
    for (const page of pages) {
      const bid = page.book_id || 'unknown';
      byBook[bid] = (byBook[bid] || 0) + 1;
    }

    return NextResponse.json({
      totalPages: pages.length,
      byBook,
      sample: pages.slice(0, 5).map(p => ({
        id: p.id,
        book_id: p.book_id,
        page_number: p.page_number,
        crop: p.crop,
        hasPhotoOriginal: !!p.photo_original
      }))
    });
  } catch (error) {
    console.error('Error checking for pages needing cropped images:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to check' },
      { status: 500 }
    );
  }
});

export const POST = withAuth(async (request, session) => {
  try {
    const body = await request.json().catch(() => ({}));
    const { bookId, limit = 100, clearStaleOcr = false, force = false } = body;

    const db = await getDb();

    // Find pages with crop data but no cropped_photo (or all cropped pages if force=true)
    const query: Record<string, unknown> = {
      'crop.xStart': { $exists: true },
    };

    if (!force) {
      query.$or = [
        { cropped_photo: { $exists: false } },
        { cropped_photo: null },
        { cropped_photo: '' }
      ];
    }

    if (bookId) {
      query.book_id = bookId;
    }

    const pages = await db.collection('pages')
      .find(query)
      .limit(limit)
      .toArray();

    if (pages.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No pages need cropped images',
        pagesFound: 0
      });
    }

    // Optionally clear stale OCR/translation stubs (have updated_at but no data)
    if (clearStaleOcr && bookId) {
      const staleResult = await db.collection('pages').updateMany(
        {
          book_id: bookId,
          $or: [
            { 'ocr.updated_at': { $exists: true }, 'ocr.data': { $exists: false } },
            { 'translation.updated_at': { $exists: true }, 'translation.data': { $exists: false } }
          ]
        },
        { $unset: { ocr: '', translation: '', summary: '' } }
      );
      console.log(`[backfill-cropped] Cleared ${staleResult.modifiedCount} stale OCR/translation stubs`);
    }

    // Process inline in batches of 5
    let imagesGenerated = 0;
    let thumbnailsGenerated = 0;
    let imageErrors = 0;
    const errors: string[] = [];

    const BATCH_SIZE = 5;
    for (let i = 0; i < pages.length; i += BATCH_SIZE) {
      const batch = pages.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(
        batch.map(async (page) => {
          if (!page.crop) return;
          const sourceUrl = page.archived_photo || page.photo_original || page.photo;
          if (!sourceUrl) {
            errors.push(`Page ${page.page_number}: no source URL`);
            imageErrors++;
            return;
          }

          try {
            const buffer = await images.fetchBuffer(sourceUrl, { timeout: 30000 });
            const { url: croppedUrl, buffer: croppedBuffer } = await cropAndUploadHalf(
              buffer, page.crop, page.book_id, page.id
            );
            const { url: thumbnailUrl } = await generateAndUploadThumbnail(
              croppedBuffer, page.book_id, page.id
            );

            await db.collection('pages').updateOne(
              { id: page.id },
              {
                $set: {
                  cropped_photo: croppedUrl,
                  thumbnail_blob: thumbnailUrl,
                  updated_at: new Date()
                }
              }
            );
            imagesGenerated++;
            thumbnailsGenerated++;
          } catch (err) {
            const msg = `Page ${page.page_number}: ${err instanceof Error ? err.message : 'Unknown error'}`;
            errors.push(msg);
            imageErrors++;
            console.error(`[backfill-cropped] ${msg}`);
          }
        })
      );
    }

    // Update book-level caches if single book
    if (bookId) {
      const [pagesOcr, pagesTranslated, totalPages] = await Promise.all([
        db.collection('pages').countDocuments({ book_id: bookId, 'ocr.data': { $exists: true, $ne: '' } }),
        db.collection('pages').countDocuments({ book_id: bookId, 'translation.data': { $exists: true, $ne: '' } }),
        db.collection('pages').countDocuments({ book_id: bookId })
      ]);

      await db.collection('books').updateOne(
        { id: bookId },
        { $set: { pages_ocr: pagesOcr, pages_translated: pagesTranslated, pages_count: totalPages } }
      );
    }

    return NextResponse.json({
      success: true,
      imagesGenerated,
      thumbnailsGenerated,
      imageErrors,
      errors: errors.slice(0, 20),
      message: `Generated ${imagesGenerated} cropped images and ${thumbnailsGenerated} thumbnails. ${imageErrors} errors.`
    });
  } catch (error) {
    console.error('Error generating cropped images:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate' },
      { status: 500 }
    );
  }
});
