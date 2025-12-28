import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDb } from '@/lib/mongodb';
import { MODEL_PRICING } from '@/lib/ai';
import { DEFAULT_MODEL } from '@/lib/types';

// Increase timeout for batch OCR
export const maxDuration = 300;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

function calculateCost(inputTokens: number, outputTokens: number, model: string): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['default'];
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

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

async function fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    let mimeType = response.headers.get('content-type') || 'image/jpeg';
    mimeType = mimeType.split(';')[0].trim();

    // Handle S3/generic content types
    if (mimeType === 'application/octet-stream') {
      mimeType = 'image/jpeg';
    }

    const supportedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    if (!supportedTypes.includes(mimeType)) {
      mimeType = 'image/jpeg';
    }

    return { data: base64, mimeType };
  } catch (error) {
    console.error('Failed to fetch image:', url, error);
    return null;
  }
}

/**
 * POST /api/books/[id]/batch-ocr
 *
 * Process OCR for pages in a book that need it.
 * Processes in batches of 5 pages at a time.
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
      language = 'Latin',
      model: modelId = DEFAULT_MODEL,
    } = await request.json().catch(() => ({}));

    const db = await getDb();

    // Get book
    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Find pages that need OCR:
    // - Have photo/photo_original
    // - Have crop (split pages) OR are single pages
    // - Don't have ocr.data
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
      // Check if all pages already have OCR
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

    // Process in batches of 5
    const batchSize = 5;
    const results: Array<{
      pageId: string;
      pageNumber: number;
      success: boolean;
      error?: string;
    }> = [];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCost = 0;

    for (let i = 0; i < pagesToProcess.length; i += batchSize) {
      const batch = pagesToProcess.slice(i, i + batchSize);

      // Prepare images for this batch
      const imagePromises = batch.map(async (page) => {
        const baseUrl = page.photo_original || page.photo;
        const imageUrl = page.crop
          ? buildCroppedImageUrl(baseUrl, page.crop)
          : baseUrl;

        const image = await fetchImageAsBase64(imageUrl);
        return { page, image, imageUrl }; // Track URL for audit
      });

      const batchData = await Promise.all(imagePromises);
      const validBatch = batchData.filter(b => b.image !== null);

      // Mark failed fetches
      batchData.filter(b => b.image === null).forEach(b => {
        results.push({
          pageId: b.page.id,
          pageNumber: b.page.page_number,
          success: false,
          error: 'Failed to fetch image'
        });
      });

      if (validBatch.length === 0) continue;

      // Build OCR prompt for batch
      const model = genAI.getGenerativeModel({ model: modelId });

      const prompt = `You are an expert OCR system specializing in historical ${language} manuscripts and printed books.

Transcribe the text from each page image accurately:
- Preserve original spelling, punctuation, and formatting
- Maintain paragraph structure
- Note any unclear or damaged text with [unclear] or [damaged]
- Keep line breaks where they appear significant
- Transcribe in reading order (left to right, top to bottom)

**You will receive ${validBatch.length} page image(s). Transcribe each one.**

**Output format:**
Return each transcription clearly separated with the exact format:

=== PAGE 1 ===
[transcription for first image]

=== PAGE 2 ===
[transcription for second image]

... and so on for each page image provided.`;

      const content: (string | { inlineData: { mimeType: string; data: string } })[] = [prompt];

      validBatch.forEach(({ image }) => {
        if (image) {
          content.push({
            inlineData: {
              mimeType: image.mimeType,
              data: image.data,
            },
          });
        }
      });

      try {
        const result = await model.generateContent(content);
        const responseText = result.response.text();

        // Parse OCR results
        const ocrResults: Record<string, string> = {};
        const parts = responseText.split(/===\s*PAGE\s*(\d+)\s*===/i);

        for (let j = 1; j < parts.length; j += 2) {
          const index = parseInt(parts[j], 10) - 1;
          const ocr = parts[j + 1]?.trim();

          if (index >= 0 && index < validBatch.length && ocr) {
            ocrResults[validBatch[index].page.id] = ocr;
          }
        }

        // Single page fallback
        if (Object.keys(ocrResults).length === 0 && validBatch.length === 1) {
          ocrResults[validBatch[0].page.id] = responseText.trim();
        }

        // Track tokens
        const usageMetadata = result.response.usageMetadata;
        const inputTokens = usageMetadata?.promptTokenCount || 0;
        const outputTokens = usageMetadata?.candidatesTokenCount || 0;
        totalInputTokens += inputTokens;
        totalOutputTokens += outputTokens;
        totalCost += calculateCost(inputTokens, outputTokens, modelId);

        // Save to database with image URL for audit trail
        const now = new Date().toISOString();
        const imageUrlMap = new Map(validBatch.map(b => [b.page.id, b.imageUrl]));
        const updatePromises = Object.entries(ocrResults).map(([pageId, ocr]) =>
          db.collection('pages').updateOne(
            { id: pageId },
            {
              $set: {
                'ocr.data': ocr,
                'ocr.updated_at': now,
                'ocr.model': modelId,
                'ocr.language': language,
                'ocr.source': 'ai',
                'ocr.image_url': imageUrlMap.get(pageId) || 'unknown',
                'ocr.batch_size': validBatch.length,
              },
            }
          )
        );
        await Promise.all(updatePromises);

        // Record results
        validBatch.forEach(({ page }) => {
          results.push({
            pageId: page.id,
            pageNumber: page.page_number,
            success: !!ocrResults[page.id],
            error: ocrResults[page.id] ? undefined : 'OCR parsing failed'
          });
        });

      } catch (error) {
        // Mark all in batch as failed
        validBatch.forEach(({ page }) => {
          results.push({
            pageId: page.id,
            pageNumber: page.page_number,
            success: false,
            error: error instanceof Error ? error.message : 'OCR failed'
          });
        });
      }
    }

    // Track total cost
    try {
      await db.collection('cost_tracking').insertOne({
        timestamp: new Date(),
        action: 'book_batch_ocr',
        bookId,
        model: modelId,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
        costUsd: totalCost,
        pagesProcessed: results.filter(r => r.success).length,
      });
    } catch (e) {
      console.error('Failed to track cost:', e);
    }

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

    return NextResponse.json({
      success: true,
      processed: results.length,
      successful: successCount,
      failed: failedCount,
      remaining: remainingCount,
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
        costUsd: totalCost.toFixed(4),
      },
      results: results.slice(0, 20), // First 20 for debugging
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
