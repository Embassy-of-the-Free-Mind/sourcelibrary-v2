import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDb } from '@/lib/mongodb';
import { MODEL_PRICING } from '@/lib/ai';
import { DEFAULT_MODEL } from '@/lib/types';
import { logGeminiCall } from '@/lib/gemini-logger';
import { notifyBatchTranslation } from '@/lib/indexnow';

// Increase timeout for batch translation
export const maxDuration = 300;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

function calculateCost(inputTokens: number, outputTokens: number, model: string): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['default'];
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

/**
 * POST /api/books/[id]/batch-translate
 *
 * Translate pages in a book that have OCR but no translation.
 * Processes in batches of 10 pages at a time.
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
        'translation.data': { $exists: false }
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
        'translation.data': { $exists: true }
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
        'translation.data': { $exists: false }
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

    // Process in batches of 10
    const batchSize = 10;
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

      // Build translation prompt
      const model = genAI.getGenerativeModel({ model: modelId });

      const pagesText = batch
        .map((p, idx) => `=== PAGE ${idx + 1} (ID: ${p.id}) ===\n${p.ocr.data}`)
        .join('\n\n');

      const prompt = `You are a scholarly translator specializing in ${sourceLanguage} to ${targetLanguage} translation.

Translate the following text pages accurately while:
- Preserving the author's meaning and style
- Using clear, modern ${targetLanguage}
- Maintaining continuity between pages
- Keeping technical terms with brief explanations if needed

**Pages to translate:**

${pagesText}

**Output format:**
Return each translation clearly separated with the exact format:

=== TRANSLATION 1 ===
[translation for page 1]

=== TRANSLATION 2 ===
[translation for page 2]

... and so on for each page.`;

      try {
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        // Parse translations
        const translations: Record<string, string> = {};
        const parts = responseText.split(/===\s*TRANSLATION\s*(\d+)\s*===/i);

        for (let j = 1; j < parts.length; j += 2) {
          const index = parseInt(parts[j], 10) - 1;
          const translation = parts[j + 1]?.trim();

          if (index >= 0 && index < batch.length && translation) {
            translations[batch[index].id] = translation;
          }
        }

        // Single page fallback
        if (Object.keys(translations).length === 0 && batch.length === 1) {
          translations[batch[0].id] = responseText.trim();
        }

        // Track tokens
        const usageMetadata = result.response.usageMetadata;
        const inputTokens = usageMetadata?.promptTokenCount || 0;
        const outputTokens = usageMetadata?.candidatesTokenCount || 0;
        totalInputTokens += inputTokens;
        totalOutputTokens += outputTokens;
        totalCost += calculateCost(inputTokens, outputTokens, modelId);

        // Save to database
        const now = new Date().toISOString();
        const updatePromises = Object.entries(translations).map(([pageId, translation]) =>
          db.collection('pages').updateOne(
            { id: pageId },
            {
              $set: {
                'translation.data': translation,
                'translation.updated_at': now,
                'translation.model': modelId,
                'translation.sourceLanguage': sourceLanguage,
                'translation.targetLanguage': targetLanguage,
              },
            }
          )
        );
        await Promise.all(updatePromises);

        // Record results
        batch.forEach((page) => {
          results.push({
            pageId: page.id,
            pageNumber: page.page_number,
            success: !!translations[page.id],
            error: translations[page.id] ? undefined : 'Translation parsing failed'
          });
        });

      } catch (error) {
        // Mark all in batch as failed
        batch.forEach((page) => {
          results.push({
            pageId: page.id,
            pageNumber: page.page_number,
            success: false,
            error: error instanceof Error ? error.message : 'Translation failed'
          });
        });
      }
    }

    // Update book's translation count and last_translation_at
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

    // Track total cost (legacy)
    try {
      await db.collection('cost_tracking').insertOne({
        timestamp: new Date(),
        action: 'book_batch_translate',
        bookId,
        model: modelId,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
        costUsd: totalCost,
        pagesProcessed: successCount,
      });
    } catch (e) {
      console.error('Failed to track cost:', e);
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
      endpoint: '/api/books/[id]/batch-translate',
    });

    // Get remaining count
    const remainingCount = await db.collection('pages').countDocuments({
      book_id: bookId,
      'ocr.data': { $exists: true, $ne: null },
      'translation.data': { $exists: false }
    });

    const failedCount = results.filter(r => !r.success).length;

    // Check if we should trigger summary generation
    // Trigger when: translation complete (remaining=0) OR >50% translated
    const totalPages = await db.collection('pages').countDocuments({ book_id: bookId });
    const translatedCount = await db.collection('pages').countDocuments({
      book_id: bookId,
      'translation.data': { $exists: true, $nin: [null, ''] }
    });
    const translationPercent = totalPages > 0 ? (translatedCount / totalPages) * 100 : 0;
    const shouldGenerateSummary = remainingCount === 0 || translationPercent > 50;

    // Auto-trigger summary generation in background if threshold met
    // and no recent summary exists
    let summaryTriggered = false;
    if (shouldGenerateSummary && successCount > 0) {
      const existingIndex = book.index;
      const indexAge = existingIndex?.generatedAt
        ? Date.now() - new Date(existingIndex.generatedAt).getTime()
        : Infinity;
      const oneHour = 60 * 60 * 1000;

      // Only trigger if no index or index is stale (>1 hour old)
      if (!existingIndex || indexAge > oneHour) {
        summaryTriggered = true;
        // Clear cache to force regeneration (non-blocking)
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
      'translation.data': { $exists: true, $ne: null }
    });
    const pagesNeedingTranslation = await db.collection('pages').countDocuments({
      book_id: bookId,
      'ocr.data': { $exists: true, $ne: null },
      'translation.data': { $exists: false }
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
