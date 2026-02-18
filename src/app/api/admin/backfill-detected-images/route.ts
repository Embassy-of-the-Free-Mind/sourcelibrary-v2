import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { parseDetectedImages, extractPageType, extractColumns } from '@/lib/types/prompts/defaults';
import { withAuth } from '@/lib/auth-helpers';

/**
 * POST /api/admin/backfill-detected-images
 *
 * Scans pages with OCR data but no detected_images, tries to parse <detected-images>
 * tags from OCR text. Uses bulkWrite for speed.
 *
 * Body: { dryRun?: boolean, limit?: number, bookId?: string }
 */
export const maxDuration = 300;

export const POST = withAuth(async (request, session) => {
  try {
    const { dryRun = true, limit = 2000, bookId } = await request.json().catch(() => ({
      dryRun: true, limit: 2000,
    }));

    const db = await getDb();

    // Use regex to find pages with <detected-images> tags but no detected_images field
    const filter: Record<string, unknown> = {
      'ocr.data': { $regex: '<detected-images>' },
      $or: [
        { detected_images: { $exists: false } },
        { detected_images: { $size: 0 } },
      ],
    };

    if (bookId) {
      filter.book_id = bookId;
    }

    // Only fetch id, book_id, and ocr.data to minimize transfer
    // Skip countDocuments — it's too slow with regex on 267k+ pages
    const pages = await db.collection('pages')
      .find(filter, { projection: { id: 1, book_id: 1, 'ocr.data': 1 } })
      .limit(limit)
      .toArray();

    const totalMatching = -1; // Skip count to avoid slow regex scan

    let updated = 0;
    let skipped = 0;
    let totalImages = 0;

    // Build bulk operations
    const bulkOps: Array<{
      updateOne: {
        filter: { id: string };
        update: { $set: Record<string, unknown> };
      };
    }> = [];

    for (const page of pages) {
      const ocrText = page.ocr?.data || '';
      if (!ocrText.includes('<detected-images>')) {
        skipped++;
        continue;
      }

      const detectedImages = parseDetectedImages(ocrText);
      if (detectedImages.length === 0) {
        skipped++;
        continue;
      }

      const pageType = extractPageType(ocrText);
      const columns = extractColumns(ocrText);
      totalImages += detectedImages.length;

      if (!dryRun) {
        bulkOps.push({
          updateOne: {
            filter: { id: page.id },
            update: {
              $set: {
                detected_images: detectedImages,
                ...(pageType && { page_type: pageType }),
                ...(columns && { columns }),
                updated_at: new Date(),
              },
            },
          },
        });
      }
      updated++;
    }

    // Execute bulk write in chunks of 500
    let bulkWritten = 0;
    if (!dryRun && bulkOps.length > 0) {
      for (let i = 0; i < bulkOps.length; i += 500) {
        const chunk = bulkOps.slice(i, i + 500);
        await db.collection('pages').bulkWrite(chunk);
        bulkWritten += chunk.length;
      }
    }

    return NextResponse.json({
      success: true,
      dryRun,
      scanned: pages.length,
      totalMatching,
      updated,
      skipped,
      totalImages,
      bulkWritten,
    });
  } catch (error) {
    console.error('Backfill detected images error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
});
