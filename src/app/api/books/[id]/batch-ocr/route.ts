import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { performOCRWithBuffer } from '@/lib/ai';
import { DEFAULT_MODEL, PROMPT_VERSION, extractPageType, parseDetectedImages } from '@/lib/types';
import { logGeminiCall } from '@/lib/gemini-logger';
import { notifyIndexNow } from '@/lib/indexnow';
import { images } from '@/lib/api-client';

// Increase timeout for batch OCR
export const maxDuration = 300;

// Build cropped image URL
function buildCroppedImageUrl(baseUrl: string, crop: { xStart: number; xEnd: number }): string {
  const baseApiUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXTAUTH_URL || 'http://localhost:3000';

  const params = new URLSearchParams({
    url: baseUrl,
    w: '2000',
    q: '95',
    cx: crop.xStart.toString(),
    cw: crop.xEnd.toString(),
  });

  return `${baseApiUrl}/api/image?${params.toString()}`;
}

function getPageImageUrl(page: Record<string, unknown>): string {
  if (page.crop && page.cropped_photo) {
    return page.cropped_photo as string;
  } else if (page.archived_photo && !page.crop) {
    return page.archived_photo as string;
  } else {
    const baseUrl = (page.archived_photo || page.photo_original || page.photo) as string;
    return page.crop
      ? buildCroppedImageUrl(baseUrl, page.crop as { xStart: number; xEnd: number })
      : baseUrl;
  }
}

/**
 * POST /api/books/[id]/batch-ocr
 *
 * Process OCR for pages in a book that need it.
 * Processes pages one at a time using the rich DEFAULT_PROMPTS.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const {
      limit = 25,
      dryRun = false,
      model: modelId = DEFAULT_MODEL,
    } = await request.json().catch(() => ({}));

    const db = await getDb();

    // Get book
    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Use book's original_language if set, otherwise auto-detect
    const language = book.original_language || '';

    // Find pages that need OCR
    const pagesToProcess = await db.collection('pages')
      .find({
        book_id: bookId,
        $or: [
          { photo: { $exists: true, $ne: null } },
          { photo_original: { $exists: true, $ne: null } }
        ],
        'ocr.data': { $exists: false }
      })
      .sort({ page_number: 1 })
      .limit(limit)
      .toArray();

    if (pagesToProcess.length === 0) {
      const totalPages = await db.collection('pages').countDocuments({ book_id: bookId });
      const pagesWithOcr = await db.collection('pages').countDocuments({
        book_id: bookId,
        'ocr.data': { $exists: true }
      });

      return NextResponse.json({
        message: 'No pages need OCR',
        processed: 0,
        totalPages,
        pagesWithOcr,
        remaining: totalPages - pagesWithOcr
      });
    }

    if (dryRun) {
      const totalNeeding = await db.collection('pages').countDocuments({
        book_id: bookId,
        $or: [
          { photo: { $exists: true, $ne: null } },
          { photo_original: { $exists: true, $ne: null } }
        ],
        'ocr.data': { $exists: false }
      });

      return NextResponse.json({
        dryRun: true,
        wouldProcess: pagesToProcess.length,
        totalNeedingOcr: totalNeeding,
        samplePages: pagesToProcess.slice(0, 5).map(p => ({
          id: p.id,
          pageNumber: p.page_number,
          hasCrop: !!p.crop
        }))
      });
    }

    // Process pages one at a time using the rich prompt
    const results: Array<{
      pageId: string;
      pageNumber: number;
      success: boolean;
      error?: string;
    }> = [];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCost = 0;
    let previousPageOcr: string | undefined;

    for (const page of pagesToProcess) {
      const imageUrl = getPageImageUrl(page);
      if (!imageUrl) {
        results.push({
          pageId: page.id,
          pageNumber: page.page_number,
          success: false,
          error: 'No image URL'
        });
        continue;
      }

      try {
        // Fetch image buffer
        const { buffer, mimeType } = await images.fetchBufferWithMimeType(imageUrl);

        // Use the shared OCR function with rich DEFAULT_PROMPTS
        const ocrResult = await performOCRWithBuffer(
          buffer,
          mimeType,
          language,
          previousPageOcr,
          undefined, // no custom prompt — use DEFAULT_PROMPTS.ocr
          modelId
        );

        // Save to database with full audit trail
        const now = new Date();
        const pageType = extractPageType(ocrResult.text);
        const detectedImages = parseDetectedImages(ocrResult.text);
        await db.collection('pages').updateOne(
          { id: page.id },
          {
            $set: {
              ocr: {
                data: ocrResult.text,
                updated_at: now,
                model: modelId,
                language,
                source: 'ai' as const,
                prompt_version: PROMPT_VERSION,
                image_url: imageUrl,
              },
              ...(pageType && { page_type: pageType }),
              ...(detectedImages.length > 0 && { detected_images: detectedImages }),
              updated_at: now
            },
          }
        );

        totalInputTokens += ocrResult.usage.inputTokens;
        totalOutputTokens += ocrResult.usage.outputTokens;
        totalCost += ocrResult.usage.costUsd;
        previousPageOcr = ocrResult.text;

        results.push({
          pageId: page.id,
          pageNumber: page.page_number,
          success: true
        });
      } catch (error) {
        results.push({
          pageId: page.id,
          pageNumber: page.page_number,
          success: false,
          error: error instanceof Error ? error.message : 'OCR failed'
        });
      }
    }

    // Log to gemini_usage for auditing
    const successfulPageIds = results.filter(r => r.success).map(r => r.pageId);
    await logGeminiCall({
      type: 'ocr',
      mode: 'realtime',
      model: modelId,
      book_id: bookId,
      book_title: book?.title,
      page_ids: successfulPageIds,
      page_count: successfulPageIds.length,
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      status: successfulPageIds.length > 0 ? 'success' : 'failed',
      prompt_version: PROMPT_VERSION,
      endpoint: '/api/books/[id]/batch-ocr',
    });

    // Get remaining count
    const remainingCount = await db.collection('pages').countDocuments({
      book_id: bookId,
      $or: [
        { photo: { $exists: true, $ne: null } },
        { photo_original: { $exists: true, $ne: null } }
      ],
      'ocr.data': { $exists: false }
    });

    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;

    // Notify search engines that book content has been updated (non-blocking)
    if (successCount > 0) {
      notifyIndexNow([`https://sourcelibrary.org/book/${bookId}`]).catch(console.error);
    }

    return NextResponse.json({
      success: true,
      processed: results.length,
      successful: successCount,
      failed: failedCount,
      remaining: remainingCount,
      promptVersion: PROMPT_VERSION,
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
        costUsd: totalCost.toFixed(4),
      },
      results: results.slice(0, 20),
    });

  } catch (error) {
    console.error('Book batch OCR error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Batch OCR failed' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/books/[id]/batch-ocr
 *
 * Check OCR status for a book
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const db = await getDb();

    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const totalPages = await db.collection('pages').countDocuments({ book_id: bookId });
    const pagesWithOcr = await db.collection('pages').countDocuments({
      book_id: bookId,
      'ocr.data': { $exists: true, $ne: null }
    });
    const pagesNeedingOcr = await db.collection('pages').countDocuments({
      book_id: bookId,
      $or: [
        { photo: { $exists: true, $ne: null } },
        { photo_original: { $exists: true, $ne: null } }
      ],
      'ocr.data': { $exists: false }
    });

    return NextResponse.json({
      bookId,
      title: book.title,
      totalPages,
      pagesWithOcr,
      pagesNeedingOcr,
      percentComplete: totalPages > 0 ? Math.round((pagesWithOcr / totalPages) * 100) : 0
    });

  } catch (error) {
    console.error('Error checking OCR status:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Check failed' },
      { status: 500 }
    );
  }
}
