import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import sharp from 'sharp';
import { getDb } from '@/lib/mongodb';
import { images } from '@/lib/api-client/images';
import { compress_photo } from '@/lib/image-manipulation';
import { getPageImageUrl } from '@/lib/utils';

export const maxDuration = 300;

const BATCH_SIZE = 10;
const DELAY_MS = 200;
const PAGES_PER_RUN = 400;
const MAX_DURATION_MS = 270_000; // Stop at 4.5 min to leave buffer

/**
 * POST /api/cron/generate-thumbnails
 *
 * Generates pre-rendered 150px JPEG thumbnails for pages that don't have them.
 * Processes multiple books per invocation, quick wins first.
 *
 * Scheduled: Every 10 minutes via Vercel cron
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const db = await getDb();
    let totalGenerated = 0;
    let totalFailed = 0;
    let pagesRemaining = PAGES_PER_RUN;
    const booksProcessed: Array<{ bookId: string; generated: number; failed: number }> = [];

    while (pagesRemaining > 0 && (Date.now() - startTime) < MAX_DURATION_MS) {
      // Find the book with the fewest pages missing thumbnails (quick wins first)
      const booksNeeding = await db.collection('pages').aggregate([
        {
          $match: {
            thumbnail_blob: { $exists: false },
            photo: { $exists: true, $nin: [null, ''] },
          }
        },
        {
          $group: {
            _id: '$book_id',
            missing: { $sum: 1 },
          }
        },
        { $sort: { missing: 1 } },
        { $limit: 1 },
      ]).toArray();

      if (booksNeeding.length === 0) break;

      const bookId = booksNeeding[0]._id;

      // Fetch pages needing thumbnails for this book
      const pagesToProcess = await db.collection('pages')
        .find({
          book_id: bookId,
          thumbnail_blob: { $exists: false },
          photo: { $exists: true, $nin: [null, ''] },
        })
        .sort({ page_number: 1 })
        .limit(pagesRemaining)
        .toArray();

      if (pagesToProcess.length === 0) break;

      let bookGenerated = 0;
      let bookFailed = 0;

      for (let i = 0; i < pagesToProcess.length; i += BATCH_SIZE) {
        if ((Date.now() - startTime) > MAX_DURATION_MS) break;

        const batch = pagesToProcess.slice(i, i + BATCH_SIZE);

        const results = await Promise.all(
          batch.map(async (page) => {
            try {
              const imageUrl = getPageImageUrl(page as unknown as Parameters<typeof getPageImageUrl>[0]);
              if (!imageUrl) return false;

              let buffer: Buffer;
              if (imageUrl.startsWith('/')) {
                const fs = await import('fs/promises');
                const path = await import('path');
                buffer = await fs.readFile(path.join(process.cwd(), 'public', imageUrl));
              } else {
                const result = await images.fetchBufferWithMimeType(imageUrl);
                buffer = result.buffer;
              }

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

              const thumbBuffer = await compress_photo(buffer, 150, 60);

              const filename = `thumbnails/${bookId}/${page.page_number}.jpg`;
              const blob = await put(filename, thumbBuffer, {
                access: 'public',
                contentType: 'image/jpeg',
                addRandomSuffix: false,
                allowOverwrite: true,
              });

              await db.collection('pages').updateOne(
                { id: page.id },
                { $set: { thumbnail_blob: blob.url, updated_at: new Date() } }
              );

              return true;
            } catch {
              return false;
            }
          })
        );

        bookGenerated += results.filter(Boolean).length;
        bookFailed += results.filter(r => !r).length;

        if (i + BATCH_SIZE < pagesToProcess.length) {
          await new Promise(r => setTimeout(r, DELAY_MS));
        }
      }

      totalGenerated += bookGenerated;
      totalFailed += bookFailed;
      pagesRemaining -= (bookGenerated + bookFailed);
      booksProcessed.push({ bookId, generated: bookGenerated, failed: bookFailed });
    }

    return NextResponse.json({
      generated: totalGenerated,
      failed: totalFailed,
      books: booksProcessed.length,
      elapsed: Math.round((Date.now() - startTime) / 1000),
      details: booksProcessed,
    });

  } catch (error) {
    console.error('Cron generate-thumbnails error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Thumbnail cron failed' },
      { status: 500 }
    );
  }
}
