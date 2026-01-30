import { handleCallback } from '@vercel/queue';
import { getDb } from '@/lib/mongodb';
import { logGeminiCall } from '@/lib/gemini-logger';
import { getGeminiClient } from '@/lib/gemini-client';
import { enqueueBookTranslation } from '@/lib/api-client/queues.server';
import type { BookBatchTranslationPayload } from '@/lib/api-client/types/queues';

/**
 * Queue Handler: book-batch-translation
 *
 * Sequential ONE-PAGE-AT-A-TIME translation for ONE book:
 * - Page 1: translate → save
 * - Page 2: fetch page 1's translation as context → translate → save
 * - Page 3: fetch page 2's translation as context → translate → save
 * - etc.
 *
 * TIMEOUT MANAGEMENT:
 * - Processes 10 pages per queue execution (stays within 5min timeout)
 * - Self-re-enqueues for next 10 pages
 * - Context maintained across queue executions (fetched from DB)
 *
 * PARALLEL BOOK PROCESSING:
 * Queue concurrency: 3 (up to 3 books can translate simultaneously)
 * - Book A: page 1 → page 2 → page 3... (sequential)
 * - Book B: page 1 → page 2 → page 3... (sequential)
 * - Book C: page 1 → page 2 → page 3... (sequential)
 *
 * Trade-offs:
 * - ✅ Perfect sequential context for quality translations
 * - ❌ 2x cost (no Batch API discount)
 * - ❌ Slower per book (but 3 books can run in parallel)
 */

export const maxDuration = 300; // 5 minute timeout

// Process 10 pages per queue execution to stay within timeout
// (300 pages would take ~50 minutes, so we batch to avoid timeout)
const PAGES_PER_TIMEOUT_WINDOW = 10;

export const POST = handleCallback({
  'book-batch-translation': {
    'default': async (message) => {
      const payload = message as BookBatchTranslationPayload;
      const {
        bookId,
        dbJobId,
        pageIds,
        model,
        sourceLanguage,
        targetLanguage,
        startPageIndex = 0
      } = payload;

      const endPageIndex = Math.min(startPageIndex + PAGES_PER_TIMEOUT_WINDOW, pageIds.length);
      const isLastExecution = endPageIndex >= pageIds.length;

      console.log(`[book-batch-translation] Book ${bookId}: processing pages ${startPageIndex + 1}-${endPageIndex}/${pageIds.length}`);

      const db = await getDb();

      // Get book info
      const book = await db.collection('books').findOne({ id: bookId });
      if (!book) {
        console.error(`[book-batch-translation] Book ${bookId} not found`);
        throw new Error('Book not found');
      }

      // Get pages for this execution
      const currentBatchPageIds = pageIds.slice(startPageIndex, endPageIndex);
      const pages = await db.collection('pages')
        .find({
          id: { $in: currentBatchPageIds },
          'ocr.data': { $exists: true, $nin: [null, ''] }
        })
        .sort({ page_number: 1 })
        .toArray();

      if (pages.length === 0) {
        console.error(`[book-batch-translation] No pages with OCR found in range ${startPageIndex}-${endPageIndex}`);

        // Skip to next batch if available
        if (!isLastExecution) {
          console.log(`[book-batch-translation] Skipping to next batch`);
          await enqueueBookTranslation({
            bookId,
            dbJobId,
            pageIds,
            model,
            sourceLanguage,
            targetLanguage,
            startPageIndex: endPageIndex
          } as BookBatchTranslationPayload);
        }

        throw new Error('No pages with OCR in this batch');
      }

      // Get Gemini client with API key rotation
      const genAI = getGeminiClient();
      const geminiModel = genAI.getGenerativeModel({ model });

      let successCount = 0;
      let failCount = 0;
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      const now = new Date().toISOString();

      // Process each page SEQUENTIALLY
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const absolutePageIndex = startPageIndex + i;
        const ocrText = page.ocr?.data;

        if (!ocrText) {
          console.warn(`[book-batch-translation] Page ${page.page_number} missing OCR, skipping`);
          failCount++;
          continue;
        }

        // Get previous page's translation for context
        let previousContext = '';
        if (absolutePageIndex > 0) {
          const prevPageId = pageIds[absolutePageIndex - 1];
          const prevPage = await db.collection('pages').findOne({ id: prevPageId });

          if (prevPage?.translation?.data) {
            // Include last ~500 chars of previous translation for context
            const prevTranslation = prevPage.translation.data;
            const contextSnippet = prevTranslation.length > 500
              ? '...' + prevTranslation.slice(-500)
              : prevTranslation;

            previousContext = `[Context from previous page]\n${contextSnippet}\n\n`;
          }
        }

        // Build prompt with sequential context
        const prompt = `You are an expert scholarly translator specializing in historical ${sourceLanguage} texts.

${previousContext}Translate the following ${sourceLanguage} text to ${targetLanguage}:

${ocrText}

Provide only the translation, maintaining the original structure and formatting.`;

        try {
          // Call real-time Gemini API
          const result = await geminiModel.generateContent(prompt);
          const response = result.response;
          const translationText = response.text();

          // Track token usage
          const usage = response.usageMetadata;
          if (usage) {
            totalInputTokens += usage.promptTokenCount || 0;
            totalOutputTokens += usage.candidatesTokenCount || 0;
          }

          // Save translation to database
          await db.collection('pages').updateOne(
            { id: page.id },
            {
              $set: {
                'translation.data': translationText,
                'translation.updated_at': now,
                'translation.model': model,
                'translation.source_language': sourceLanguage,
                'translation.target_language': targetLanguage,
                'translation.source': 'realtime_api_sequential',
                updated_at: new Date()
              }
            }
          );

          successCount++;
          console.log(`[book-batch-translation] ✓ Page ${page.page_number} (${absolutePageIndex + 1}/${pageIds.length})`);

        } catch (error) {
          console.error(`[book-batch-translation] ✗ Failed page ${page.page_number}:`, error);
          failCount++;

          // Continue processing remaining pages even if one fails
        }
      }

      // Log API usage for this execution
      await logGeminiCall({
        type: 'translate',
        mode: 'realtime',
        model,
        book_id: bookId,
        book_title: book?.title,
        page_ids: pages.slice(0, successCount).map(p => p.id),
        page_count: successCount,
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        status: successCount > 0 ? 'success' : 'failed',
        endpoint: '/api/queue/book-batch-translation',
      });

      console.log(`[book-batch-translation] Batch complete: ${successCount} success, ${failCount} failed`);

      // Check if there are more pages to process
      if (!isLastExecution) {
        console.log(`[book-batch-translation] Re-enqueuing for pages ${endPageIndex + 1}-${Math.min(endPageIndex + PAGES_PER_TIMEOUT_WINDOW, pageIds.length)}`);

        // Re-enqueue for next batch
        await enqueueBookTranslation({
          bookId,
          dbJobId,
          pageIds,
          model,
          sourceLanguage,
          targetLanguage,
          startPageIndex: endPageIndex
        } as BookBatchTranslationPayload);

        console.log(`[book-batch-translation] Processed pages ${startPageIndex + 1}-${endPageIndex}. Continuing...`);
      } else {
        // All pages done - mark job as completed
        await db.collection('jobs').updateOne(
          { id: dbJobId },
          {
            $set: {
              status: 'completed',
              completed_at: new Date(),
              updated_at: new Date()
            }
          }
        );

        console.log(`[book-batch-translation] ✅ Book ${bookId} fully translated! (${pageIds.length} pages)`);
      }
    }
  }
});
