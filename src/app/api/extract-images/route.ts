import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { logGeminiCall } from '@/lib/gemini-logger';
import {
  extractWithGemini,
  extractWithMistral,
  extractWithGroundingDino,
  type DetectedImage
} from '@/lib/image-extraction';
import { withAuth } from '@/lib/auth-helpers';

/**
 * POST /api/extract-images
 *
 * Run image extraction on pages with illustrations.
 * Body: { limit?: number, bookId?: string, model?: 'gemini' | 'mistral' | 'grounding-dino' }
 */

export const POST = withAuth(async (request, session) => {
  try {
    const body = await request.json();
    const limit = Math.min(body.limit || 5, 20); // Max 20 pages
    const bookId = body.bookId;
    const dryRun = body.dryRun || false;
    const model: 'gemini' | 'mistral' | 'grounding-dino' = body.model || 'gemini';

    const useGemini = model === 'gemini';
    const extractFn = model === 'mistral'
      ? extractWithMistral
      : model === 'grounding-dino'
        ? extractWithGroundingDino
        : null; // Gemini handled separately below for usage tracking

    const db = await getDb();

    // Find pages with image URLs
    // If bookId specified, process ALL pages with photos (for full extraction)
    // Otherwise, only process pages with image indicators in OCR
    const hasImageUrl = {
      $or: [
        { cropped_photo: { $exists: true, $ne: '' } },
        { photo_original: { $exists: true, $ne: '' } },
        { photo: { $exists: true, $ne: '' } }
      ]
    };

    let query: Record<string, unknown>;

    if (bookId) {
      // For specific book: process all pages with photos
      query = { book_id: bookId, ...hasImageUrl };
    } else {
      // For general extraction: only pages with image indicators
      query = {
        $and: [
          {
            $or: [
              { 'detected_images.0': { $exists: true } },
              { 'ocr.data': { $regex: '\\[\\[image:', $options: 'i' } },
              { 'ocr.data': { $regex: '<image-desc>', $options: 'i' } },
              { 'ocr.data': { $regex: '<detected-images>', $options: 'i' } }
            ]
          },
          hasImageUrl
        ]
      };
    }

    const pages = await db.collection('pages').aggregate([
      { $match: query },
      { $sample: { size: limit } },
      {
        $lookup: {
          from: 'books',
          localField: 'book_id',
          foreignField: 'id',
          as: 'book'
        }
      },
      { $unwind: { path: '$book', preserveNullAndEmptyArrays: true } }
    ]).toArray();

    const results: Array<{
      pageId: string;
      bookTitle: string;
      pageNumber: number;
      imageUrl: string;
      existingImages: number;
      extractedImages: DetectedImage[];
      latencyMs: number;
      error?: string;
    }> = [];

    // Track aggregate token usage for Gemini calls
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const geminiModelId = body.geminiModel || 'gemini-3-flash-preview';

    for (const page of pages) {
      const imageUrl = page.cropped_photo || page.photo_original || page.photo;
      if (!imageUrl) continue;

      const start = Date.now();
      let extractedImages: DetectedImage[] = [];
      let error: string | undefined;

      try {
        if (useGemini) {
          const bookContext = page.book ? {
            title: page.book.display_title || page.book.title,
            author: page.book.author,
            year: page.book.year,
            language: page.book.language,
            subjects: page.book.faceted_tags?.knowledge_domain,
            cultural_sphere: page.book.faceted_tags?.cultural_sphere?.[0],
          } : undefined;
          const result = await extractWithGemini(imageUrl, geminiModelId, { returnUsage: true, bookContext });
          extractedImages = result.images;
          totalInputTokens += result.usage.inputTokens;
          totalOutputTokens += result.usage.outputTokens;
        } else {
          extractedImages = await extractFn!(imageUrl);
        }

        // Update the page with extracted images (unless dry run)
        if (!dryRun && extractedImages.length > 0) {
          await db.collection('pages').updateOne(
            { _id: page._id },
            { $set: { detected_images: extractedImages } }
          );
        }
      } catch (e) {
        error = e instanceof Error ? e.message : 'Unknown error';
      }

      results.push({
        pageId: page.id,
        bookTitle: page.book?.title || 'Unknown',
        pageNumber: page.page_number,
        imageUrl,
        existingImages: page.detected_images?.length || 0,
        extractedImages,
        latencyMs: Date.now() - start,
        error,
      });
    }

    // Summary stats
    const totalExtracted = results.reduce((sum, r) => sum + r.extractedImages.length, 0);
    const avgLatency = results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length;
    const errors = results.filter(r => r.error).length;
    const withBbox = results.reduce(
      (sum, r) => sum + r.extractedImages.filter(i => i.bbox).length,
      0
    );

    // Log Gemini usage (only for gemini model)
    if (useGemini && results.length > 0) {
      await logGeminiCall({
        type: 'extract_images',
        mode: 'realtime',
        model: geminiModelId,
        book_id: bookId || undefined,
        page_ids: results.map(r => r.pageId),
        page_count: results.length,
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        status: errors > 0 ? 'failed' : 'success',
        endpoint: '/api/extract-images',
      });
    }

    return NextResponse.json({
      summary: {
        model,
        pagesProcessed: results.length,
        totalImagesExtracted: totalExtracted,
        imagesWithBbox: withBbox,
        avgLatencyMs: Math.round(avgLatency),
        errors,
        dryRun,
      },
      results,
    });
  } catch (error) {
    console.error('Extract images error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to extract images' },
      { status: 500 }
    );
  }
});

// GET - check status / get pages with images
export const GET = withAuth(async (request, session) => {
  try {
    const db = await getDb();

    // Count pages with detected images
    const withImages = await db.collection('pages').countDocuments({
      'detected_images.0': { $exists: true }
    });

    // Count pages with OCR image tags (potential candidates)
    const withOcrTags = await db.collection('pages').countDocuments({
      'ocr.data': { $regex: '\\[\\[image:', $options: 'i' }
    });

    // Count pages with vision-extracted images
    const withVisionExtracted = await db.collection('pages').countDocuments({
      'detected_images.detection_source': 'vision_model'
    });

    return NextResponse.json({
      pagesWithDetectedImages: withImages,
      pagesWithOcrImageTags: withOcrTags,
      pagesWithVisionExtraction: withVisionExtracted,
      usage: {
        method: 'POST',
        body: '{ "limit": 5, "bookId": "optional", "dryRun": true }',
      }
    });
  } catch (error) {
    console.error('Get images status error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get status' },
      { status: 500 }
    );
  }
});
