import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { performTranslation } from '@/lib/ai';
import { DEFAULT_MODEL, PROMPT_VERSION } from '@/lib/types';
import { logGeminiCall } from '@/lib/gemini-logger';
import { notifyBatchTranslation } from '@/lib/indexnow';

// Increase timeout for batch translation
export const maxDuration = 300;

/**
 * POST /api/books/[id]/batch-translate
 *
 * Translate pages in a book that have OCR but no translation.
 * Processes pages one at a time using the rich DEFAULT_PROMPTS with previous page context.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const {
      limit = 50,
      dryRun = false,
      sourceLanguage = 'Latin',
      targetLanguage = 'English',
      model: modelId = DEFAULT_MODEL,
    } = await request.json().catch(() => ({}));

    const db = await getDb();

    // Get book
    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Find pages that have OCR but no translation
    const pagesToProcess = await db.collection('pages')
      .find({
        book_id: bookId,
        'ocr.data': { $exists: true, $nin: [null, ''] },
        'translation.data': { $in: [null, ''] }
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
      const pagesWithTranslation = await db.collection('pages').countDocuments({
        book_id: bookId,
        'translation.data': { $exists: true, $nin: [null, ''] }
      });

      return NextResponse.json({
        message: 'No pages need translation',
        processed: 0,
        totalPages,
        pagesWithOcr,
        pagesWithTranslation,
        remaining: pagesWithOcr - pagesWithTranslation
      });
    }

    if (dryRun) {
      const totalNeeding = await db.collection('pages').countDocuments({
        book_id: bookId,
        'ocr.data': { $exists: true, $ne: null },
        'translation.data': { $in: [null, ''] }
      });

      return NextResponse.json({
        dryRun: true,
        wouldProcess: pagesToProcess.length,
        totalNeedingTranslation: totalNeeding,
        samplePages: pagesToProcess.slice(0, 5).map(p => ({
          id: p.id,
          pageNumber: p.page_number,
          ocrLength: p.ocr?.data?.length || 0
        }))
      });
    }

    // Process pages one at a time using the rich prompt with context
    const results: Array<{
      pageId: string;
      pageNumber: number;
      success: boolean;
      error?: string;
    }> = [];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCost = 0;
    let previousPageTranslation: string | undefined;

    // Get the translation from the page just before our first page for context
    if (pagesToProcess.length > 0 && pagesToProcess[0].page_number > 1) {
      const prevPage = await db.collection('pages').findOne({
        book_id: bookId,
        page_number: pagesToProcess[0].page_number - 1,
        'translation.data': { $exists: true }
      });
      if (prevPage?.translation?.data) {
        previousPageTranslation = prevPage.translation.data;
      }
    }

    for (const page of pagesToProcess) {
      if (!page.ocr?.data) {
        results.push({
          pageId: page.id,
          pageNumber: page.page_number,
          success: false,
          error: 'No OCR data'
        });
        continue;
      }

      try {
        // Use the shared translation function with rich DEFAULT_PROMPTS
        const translationResult = await performTranslation(
          page.ocr.data,
          sourceLanguage,
          targetLanguage,
          previousPageTranslation,
          undefined, // no custom prompt — use DEFAULT_PROMPTS.translation
          modelId
        );

        // Save to database with full audit trail
        const now = new Date();
        await db.collection('pages').updateOne(
          { id: page.id },
          {
            $set: {
              'translation.data': translationResult.text,
              'translation.updated_at': now,
              'translation.model': modelId,
              'translation.language': targetLanguage,
              'translation.sourceLanguage': sourceLanguage,
              'translation.targetLanguage': targetLanguage,
              'translation.source': 'ai',
              'translation.prompt_version': PROMPT_VERSION,
              updated_at: now
            },
          }
        );

        totalInputTokens += translationResult.usage.inputTokens;
        totalOutputTokens += translationResult.usage.outputTokens;
        totalCost += translationResult.usage.costUsd;
        previousPageTranslation = translationResult.text;

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
          error: error instanceof Error ? error.message : 'Translation failed'
        });
      }
    }

    // Update book's translation count
    const successCount = results.filter(r => r.success).length;
    if (successCount > 0) {
      const now = new Date();
      const translatedCount = await db.collection('pages').countDocuments({
        book_id: bookId,
        'translation.data': { $exists: true, $nin: [null, ''] }
      });
      await db.collection('books').updateOne(
        { id: bookId },
        { $set: { pages_translated: translatedCount, last_translation_at: now, updated_at: now } }
      );

      // Notify search engines of new translations via IndexNow (non-blocking)
      const translatedPageNumbers = results.filter(r => r.success).map(r => r.pageNumber);
      notifyBatchTranslation(bookId, translatedPageNumbers).catch(console.error);
    }

    // Log to gemini_usage for auditing
    const successfulPageIds = results.filter(r => r.success).map(r => r.pageId);
    await logGeminiCall({
      type: 'translate',
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
      endpoint: '/api/books/[id]/batch-translate',
    });

    // Get remaining count
    const remainingCount = await db.collection('pages').countDocuments({
      book_id: bookId,
      'ocr.data': { $exists: true, $ne: null },
      'translation.data': { $in: [null, ''] }
    });

    const failedCount = results.filter(r => !r.success).length;

    // Check if we should trigger summary generation
    const totalPages = await db.collection('pages').countDocuments({ book_id: bookId });
    const translatedCount = await db.collection('pages').countDocuments({
      book_id: bookId,
      'translation.data': { $exists: true, $nin: [null, ''] }
    });
    const translationPercent = totalPages > 0 ? (translatedCount / totalPages) * 100 : 0;
    const shouldGenerateSummary = remainingCount === 0 || translationPercent > 50;

    let summaryTriggered = false;
    if (shouldGenerateSummary && successCount > 0) {
      const existingIndex = book.index;
      const indexAge = existingIndex?.generatedAt
        ? Date.now() - new Date(existingIndex.generatedAt).getTime()
        : Infinity;
      const oneHour = 60 * 60 * 1000;

      if (!existingIndex || indexAge > oneHour) {
        summaryTriggered = true;
        db.collection('books').updateOne(
          { id: bookId },
          { $unset: { index: '' } }
        ).catch(console.error);
      }
    }

    return NextResponse.json({
      success: true,
      processed: results.length,
      successful: successCount,
      failed: failedCount,
      remaining: remainingCount,
      translationPercent: Math.round(translationPercent),
      summaryTriggered,
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
    console.error('Book batch translate error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Batch translation failed' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/books/[id]/batch-translate
 *
 * Check translation status for a book
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
    const pagesWithTranslation = await db.collection('pages').countDocuments({
      book_id: bookId,
      'translation.data': { $exists: true, $nin: [null, ''] }
    });
    const pagesNeedingTranslation = await db.collection('pages').countDocuments({
      book_id: bookId,
      'ocr.data': { $exists: true, $ne: null },
      'translation.data': { $in: [null, ''] }
    });

    return NextResponse.json({
      bookId,
      title: book.title,
      totalPages,
      pagesWithOcr,
      pagesWithTranslation,
      pagesNeedingTranslation,
      percentComplete: pagesWithOcr > 0 ? Math.round((pagesWithTranslation / pagesWithOcr) * 100) : 0
    });

  } catch (error) {
    console.error('Error checking translation status:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Check failed' },
      { status: 500 }
    );
  }
}
