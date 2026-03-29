import { getDb } from '@/lib/mongodb';
import type { PageProcessingMessage } from '@/lib/types/sqs';
import type { TranslationWriteResult, GeminiUsagePayload } from '@/lib/types/sqs';
import { performTranslation } from '@/lib/ai';
import { DEFAULT_MODEL, getModelForBook } from '@/lib/types';
import { SKIP_TRANSLATION_PAGE_TYPES, extractPageType } from '@/lib/types/prompts/defaults';
import { classifyError } from '@/lib/errors';
import { extractTranslationMetadata, propagateOcrWarnings } from '@/lib/translation-metadata';
import { createRevision } from '@/lib/page-revisions';
import { sendWriteResult } from '@/lib/sqs-client';
import { retryDbWrite } from '@/lib/retry-utils';
import { contentHash } from '@/lib/steganographia';
import { getTranslationPrompt } from '@/lib/prompts';
import type { PromptReference } from '@/lib/types';

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
    errorMessage?: string; errorCategory?: string; promptRef?: PromptReference }
): GeminiUsagePayload {
  return {
    type: 'translation',
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
    prompt_version: opts.promptRef ? `v${opts.promptRef.version}` : 'unknown',
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

  // Fetch book metadata for translation context (title, author, year)
  const bookDoc = await db.collection('books').findOne(
    { id: bookId },
    { projection: { title: 1, display_title: 1, author: 1, year: 1, published: 1, 'image_source.provider': 1 } }
  );
  const bookContext = bookDoc ? {
    title: bookDoc.display_title || bookDoc.title,
    author: bookDoc.author,
    year: bookDoc.year || bookDoc.published,
  } : undefined;

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
  // Check both the stored page_type AND the OCR text's <page-type> tag.
  // The tag check catches race conditions where OCR was saved but page_type
  // wasn't written yet (e.g., write-processor hadn't run).
  const effectivePageType = page.page_type || extractPageType(page.ocr.data);
  if (effectivePageType && SKIP_TRANSLATION_PAGE_TYPES.includes(effectivePageType)) {
    console.log(`[TRANS] Skipping page ${pageId} (page_type: ${effectivePageType})`);
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

  const modelId = job.config.model || getModelForBook(bookDoc as { image_source?: { provider?: string } } | null) || DEFAULT_MODEL;
  const startTime = Date.now();

  // Resolve the translation prompt from DB (source of truth for prompt content + version)
  const sourceLanguage = job.config.language || 'Latin';
  const promptLookup = await getTranslationPrompt(
    sourceLanguage,
    'English',
    customPrompt ? { customText: customPrompt } : undefined
  );
  const promptRef = promptLookup.reference;
  console.log(`[TRANS] Using prompt "${promptRef.name}" v${promptRef.version} (hash: ${promptRef.content_hash || 'n/a'})`);

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

    // Pass the DB-resolved prompt text as customPrompt so performTranslation uses it
    const translationResult = await performTranslation(
      page.ocr.data,
      sourceLanguage,
      'English',
      context ?? undefined,
      promptLookup.text,
      modelId,
      bookContext
    );

    const durationMs = Date.now() - startTime;

    // Propagate OCR quality warnings to translation so readers see them on both sides
    const finalTranslation = propagateOcrWarnings(page.ocr.data, translationResult.text);

    // DIRECT WRITE: Save translation to page — required for FIFO context chain.
    // The next page in the queue reads this translation for continuity.
    const translationMeta = extractTranslationMetadata(finalTranslation);
    await retryDbWrite(() => pages.updateOne(
      { id: pageId },
      {
        $set: {
          translation: {
            data: finalTranslation,
            content_hash: contentHash(finalTranslation),
            language: 'English',
            model: modelId,
            updated_at: new Date(),
            source: 'ai',
            prompt_version: `v${promptRef.version}`,
            prompt_hash: promptRef.content_hash,
            prompt_id: promptRef.id,
            prompt_name: promptRef.name,
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
        promptRef,
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
        promptRef,
      }),
    });
  }
}

// checkJobCompletion is now handled by the Writer Lambda via shared job-completion.ts
