import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { put } from '@vercel/blob';

export const maxDuration = 300; // 5 minute timeout

const BATCH_SIZE = 10; // Pages per batch
const DELAY_MS = 200; // Delay between batches

/**
 * POST /api/cron/archive-ocr
 *
 * Archive OCR images to Vercel Blob storage.
 * Ensures all OCR'd pages have fast, reliable image access.
 *
 * Scheduled: Every 4 hours via Vercel cron
 * Can also be called manually via: curl https://your-domain.com/api/cron/archive-ocr
 */
export async function POST(request: NextRequest) {
  try {
    const db = await getDb();

    // Find pages with OCR data that need archiving
    const query = {
      // Has OCR data
      'ocr.data': { $exists: true, $ne: null, $ne: '' },
      // Has an image source
      photo: { $exists: true, $ne: null, $ne: '' },
      // Not already archived
      $or: [
        { archived_photo: { $exists: false } },
        { archived_photo: null },
        { archived_photo: '' }
      ]
    };

    const totalCount = await db.collection('pages').countDocuments(query);

    if (totalCount === 0) {
      return NextResponse.json({
        success: true,
        message: 'No pages need archiving',
        archived: 0,
        failed: 0,
        totalSize: '0MB',
      });
    }

    let archived = 0;
    let failed = 0;
    let totalBytes = 0;
    let startTime = Date.now();
    const batchResults = [];

    // Process in batches
    while (true) {
      const pages = await db.collection('pages')
        .find(query)
        .limit(BATCH_SIZE)
        .toArray();

      if (pages.length === 0) break;

      // Process batch in parallel
      const results = await Promise.all(
        pages.map(async (page: any) => {
          const sourceUrl = page.photo;

          try {
            // Download image
            const response = await fetch(sourceUrl, { timeout: 30000 });
            if (!response.ok) {
              return { success: false, pageId: page.id, error: `HTTP ${response.status}` };
            }

            const buffer = await response.arrayBuffer();
            const bytes = buffer.byteLength;

            // Upload to Vercel Blob
            const filename = `archived/${page.book_id}/${page.page_number}.jpg`;
            const blob = await put(filename, Buffer.from(buffer), {
              access: 'public',
              contentType: response.headers.get('content-type') || 'image/jpeg',
              addRandomSuffix: false,
            });

            // Update page record
            await db.collection('pages').updateOne(
              { id: page.id },
              {
                $set: {
                  archived_photo: blob.url,
                  'archive_metadata.archived_at': new Date(),
                  'archive_metadata.source_url': sourceUrl,
                  'archive_metadata.bytes': bytes,
                  updated_at: new Date()
                }
              }
            );

            return { success: true, pageId: page.id, bytes };
          } catch (error: any) {
            // Skip "already exists" errors - page was already archived
            if (error.message?.includes('already exists')) {
              return { success: true, pageId: page.id, bytes: 0, skipped: true };
            }
            return {
              success: false,
              pageId: page.id,
              error: error.message
            };
          }
        })
      );

      // Count results
      for (const r of results) {
        if (r.success) {
          archived++;
          totalBytes += r.bytes;
        } else {
          failed++;
        }
      }

      batchResults.push({
        batchSize: results.length,
        archived: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
      });

      // Delay between batches
      await new Promise(r => setTimeout(r, DELAY_MS));
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const mb = (totalBytes / (1024 * 1024)).toFixed(1);

    return NextResponse.json({
      success: true,
      message: `Archived OCR images to Vercel Blob`,
      archived,
      failed,
      totalSize: `${mb}MB`,
      duration: `${duration}s`,
      batchCount: batchResults.length,
    });
  } catch (error) {
    console.error('Archive OCR error:', error);
    return NextResponse.json(
      { error: 'Archive OCR failed', details: String(error) },
      { status: 500 }
    );
  }
}
