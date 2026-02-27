import { getDb } from '@/lib/mongodb';
import type { PageProcessingMessage } from '@/lib/types/sqs';
import type { TranslationWriteResult, GeminiUsagePayload } from '@/lib/types/sqs';
import { performTranslation } from '@/lib/ai';
import { DEFAULT_MODEL, PROMPT_VERSION } from '@/lib/types';
import { SKIP_TRANSLATION_PAGE_TYPES } from '@/lib/types/prompts/defaults';
import { classifyError } from '@/lib/errors';
import { extractTranslationMetadata } from '@/lib/translation-metadata';
import { createRevision } from '@/lib/page-revisions';
import { sendWriteResult } from '@/lib/sqs-client';
import { retryDbWrite } from '@/lib/retry-utils';

/**
 * Translation Processor - processes one page at a time
 *
 * WRITE QUEUE (hybrid): This worker writes the translation text directly
 * to MongoDB (required for FIFO context chain — next page needs to read
 * the previous page's translation). All other writes (logging, progress,
 * completion) are deferred to the write-results queue.
 *
 * Flow:
 * 1. Check if job is cancelled
 * 2. Get previous page's translation for context
 * 3. Translate current page with context
 * 4. Save translation to page (DIRECT WRITE — required for context chain)
 * 5. Send logging + completion check to write queue
 */
/**
 * Build a GeminiUsagePayload for the write queue.
 */
function buildUsagePayload(
  opts: { model: string; bookId: string; pageId: string; jobId: string; durationMs: number;
    inputTokens: number; outputTokens: number; status: 'success' | 'failed';
    errorMessage?: string; errorCategory?: string }
): GeminiUsagePayload {
  return {
    type: 'translate',
    mode: 'realtime',
    model: opts.model,
    book_id: opts.bookId,
    page_ids: [opts.pageId],
    input_tokens: opts.inputTokens,
    output_tokens: opts.outputTokens,
    status: opts.status,
    ...(opts.errorMessage && { error_message: opts.errorMessage }),
    ...(opts.errorCategory && { error_category: opts.errorCategory }),
    job_id: opts.jobId,
    duration_ms: opts.durationMs,
    prompt_version: PROMPT_VERSION,
    endpoint: 'worker/translation',
  };
}

export async function processTranslationPage(message: PageProcessingMessage) {
  const { bookId, pageId, jobId, customPrompt } = message;

  console.log(`[TRANS] Processing page ${pageId} for job ${jobId}`);

  const db = await getDb();
  const jobs = db.collection('jobs');
  const pages = db.collection('pages');

  // Check if job is cancelled
  const job = await jobs.findOne({ id: jobId });
  if (!job) {
    console.error(`[TRANS] Job ${jobId} not found`);
    return;
  }

  if (job.status === 'cancelled') {
    console.log(`[TRANS] Job ${jobId} is cancelled, skipping page ${pageId}`);
    return;
  }

  if (job.status === 'completed' || job.status === 'completed_with_errors' || job.status === 'failed') {
    console.log(`[TRANS] Job ${jobId} already ${job.status}, skipping stale message for page ${pageId}`);
    return;
  }

  const targetPageIds = job.config?.page_ids || [];

  // Update job status to processing (if still pending)
  if (job.status === 'pending') {
    await jobs.updateOne(
      { id: jobId },
      { $set: { status: 'processing', updated_at: new Date() } }
    );
  }

  // Get page
  const page = await pages.findOne({ id: pageId });
  if (!page) {
    console.error(`[TRANS] Page ${pageId} not found`);
    await sendWriteResult({
      type: 'translation',
      bookId, pageId, jobId, targetPageIds,
      timestamp: new Date().toISOString(),
      failed: true,
      error: { message: 'Page not found', category: 'no_data' },
    });
    return;
  }

  // Check if page has OCR
  if (!page.ocr?.data) {
    console.error(`[TRANS] Page ${pageId} has no OCR data`);
    await sendWriteResult({
      type: 'translation',
      bookId, pageId, jobId, targetPageIds,
      timestamp: new Date().toISOString(),
      failed: true,
      error: { message: 'No OCR data on page', category: 'no_data' },
    });
    return;
  }

  // Skip pages with no meaningful text content (blank, illustration, etc.)
  if (page.page_type && SKIP_TRANSLATION_PAGE_TYPES.includes(page.page_type)) {
    console.log(`[TRANS] Skipping page ${pageId} (page_type: ${page.page_type})`);
    await sendWriteResult({
      type: 'translation',
      bookId, pageId, jobId, targetPageIds,
      timestamp: new Date().toISOString(),
      failed: false,
    });
    return;
  }

  // Skip if page already has a translation that's current with the OCR
  // Prevents waste from stale queue messages re-translating already-done pages
  // Pass force: true in job config to override (e.g., retranslation with new prompt)
  if (!job.config?.force && page.translation?.data && page.translation?.updated_at && page.ocr?.updated_at) {
    const ocrTime = new Date(page.ocr.updated_at).getTime();
    const transTime = new Date(page.translation.updated_at).getTime();
    if (transTime >= ocrTime) {
      console.log(`[TRANS] Skipping page ${pageId} (translation already current, ${page.translation.model || 'unknown'})`);
      await sendWriteResult({
        type: 'translation',
        bookId, pageId, jobId, targetPageIds,
        timestamp: new Date().toISOString(),
        failed: false,
      });
      return;
    }
  }

  const modelId = job.config.model || DEFAULT_MODEL;
  const startTime = Date.now();

  // Snapshot manually-edited content before overwriting
  try {
    await createRevision(pageId, 'translation', jobId);
  } catch (snapErr) {
    console.error(`[TRANS] Snapshot failed for page ${pageId} (non-fatal):`, snapErr);
  }

  try {
    // Get context from previous page (for sequential translation)
    let context = null;
    if (page.page_number > 1) {
      const prevPage = await pages.findOne({
        book_id: bookId,
        page_number: page.page_number - 1,
        'translation.data': { $exists: true }
      });
      if (prevPage?.translation?.data) {
        context = prevPage.translation.data;
      }
    }

    // Translate with custom prompt if provided
    const translationResult = await performTranslation(
      page.ocr.data,
      job.config.language || 'Latin',
      'English',
      context ?? undefined,
      customPrompt,
      modelId
    );

    const durationMs = Date.now() - startTime;

    // DIRECT WRITE: Save translation to page — required for FIFO context chain.
    // The next page in the queue reads this translation for continuity.
    const translationMeta = extractTranslationMetadata(translationResult.text);
    await retryDbWrite(() => pages.updateOne(
      { id: pageId },
      {
        $set: {
          translation: {
            data: translationResult.text,
            language: 'English',
            model: modelId,
            updated_at: new Date(),
            source: 'ai',
            prompt_version: PROMPT_VERSION
          },
          ...translationMeta,
          updated_at: new Date()
        }
      }
    ), `save translation for page ${pageId}`, 3, '[TRANS]');

    // Defer logging + completion check to write queue
    await sendWriteResult({
      type: 'translation',
      bookId, pageId, jobId, targetPageIds,
      timestamp: new Date().toISOString(),
      failed: false,
      geminiUsage: buildUsagePayload({
        model: modelId, bookId, pageId, jobId, durationMs,
        inputTokens: translationResult.usage.inputTokens,
        outputTokens: translationResult.usage.outputTokens,
        status: 'success',
      }),
    });

    console.log(`[TRANS] Completed page ${pageId}, ${durationMs}ms`);
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const classified = classifyError(error);
    console.error(`[TRANS] Failed to process page ${pageId} [${classified.category}]:`, error);

    // Send failure to write queue — writer handles logging + job progress
    await sendWriteResult({
      type: 'translation',
      bookId, pageId, jobId, targetPageIds,
      timestamp: new Date().toISOString(),
      failed: true,
      error: { message: classified.message, category: classified.category },
      geminiUsage: buildUsagePayload({
        model: modelId, bookId, pageId, jobId, durationMs,
        inputTokens: 0, outputTokens: 0, status: 'failed',
        errorMessage: classified.message, errorCategory: classified.category,
      }),
    });
  }
}

// checkJobCompletion is now handled by the Writer Lambda via shared job-completion.ts
