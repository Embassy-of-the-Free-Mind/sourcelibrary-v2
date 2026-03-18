/**
 * OCR Processor Logic
 *
 * Processes one page at a time for OCR.
 * Used by AWS Lambda in production.
 *
 * WRITE QUEUE: This worker does NOT write AI results to MongoDB directly.
 * Instead, it sends results to the write-results SQS queue, which the
 * Writer Lambda consumes with capped concurrency (50) to prevent
 * MongoDB connection storms during large batch jobs.
 *
 * Remaining direct DB operations (reads + lightweight status writes):
 * - jobs.findOne (check if cancelled)
 * - jobs.updateOne (set status to 'processing' — once per job)
 * - pages.findOne (get page data)
 * - prompts.findOne (get OCR prompt)
 * - createRevision (snapshot before overwrite)
 * - jobs.updateOne (skip/already-current progress increment)
 */

import { getDb } from '@/lib/mongodb';
import type { PageProcessingMessage } from '@/lib/types/sqs';
import type { OcrWriteResult, GeminiUsagePayload } from '@/lib/types/sqs';
import { performOCRWithBuffer } from '@/lib/ai';
import { DEFAULT_MODEL } from '@/lib/types/ai-models';
import { PROMPT_VERSION, extractPageType, extractColumns, parseDetectedImages } from '@/lib/types/prompts/defaults';
import { images } from '@/lib/api-client/images';
import type { Page } from '@/lib/types/page';
import { classifyError } from '@/lib/errors';
import { createRevision } from '@/lib/page-revisions';
import { getOcrPrompt } from '@/lib/prompts';
import { sendWriteResult } from '@/lib/sqs-client';

import { getPageImageUrl, isArchiveFailed } from '@/lib/utils';

/**
 * Build a GeminiUsagePayload for the write queue.
 */
function buildUsagePayload(
  opts: { model: string; bookId: string; pageId: string; jobId: string; durationMs: number;
    inputTokens: number; outputTokens: number; status: 'success' | 'failed';
    errorMessage?: string; errorCategory?: string }
): GeminiUsagePayload {
  return {
    type: 'ocr',
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
    endpoint: 'worker/ocr',
  };
}

export async function processOcrPage(message: PageProcessingMessage): Promise<void> {
  const { bookId, pageId, jobId, customPrompt } = message;

  console.log(`[OCR] Processing page ${pageId} for job ${jobId}`);

  const db = await getDb();
  const jobs = db.collection('jobs');
  const pages = db.collection('pages');

  // Check if job is cancelled
  const job = await jobs.findOne({ id: jobId });
  if (!job) {
    console.error(`[OCR] Job ${jobId} not found`);
    return;
  }

  if (job.status === 'cancelled') {
    console.log(`[OCR] Job ${jobId} is cancelled, skipping page ${pageId}`);
    return;
  }

  if (job.status === 'completed' || job.status === 'completed_with_errors' || job.status === 'failed') {
    console.log(`[OCR] Job ${jobId} already ${job.status}, skipping stale message for page ${pageId}`);
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
  const page = await pages.findOne({ id: pageId }) as Page | null;
  if (!page) {
    console.error(`[OCR] Page ${pageId} not found`);
    await sendWriteResult({
      type: 'ocr',
      bookId,
      pageId,
      jobId,
      targetPageIds,
      timestamp: new Date().toISOString(),
      failed: true,
      error: { message: 'Page not found', category: 'no_data' },
    });
    return;
  }

  const modelId = job.config.model || DEFAULT_MODEL;

  // Get image URL with priority fallbacks
  const imageUrl = getPageImageUrl(page);
  if (!imageUrl || (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://'))) {
    const reason = isArchiveFailed(page.archived_photo)
      ? `archived_photo="${page.archived_photo}" — source URL dead`
      : !imageUrl ? 'no image URL on page' : `non-HTTP image URL: ${imageUrl.substring(0, 100)}`;
    console.error(`[OCR] Page ${pageId}: ${reason}`);

    // Send failure to write queue — writer will log to gemini_usage and update job progress
    await sendWriteResult({
      type: 'ocr',
      bookId,
      pageId,
      jobId,
      targetPageIds,
      timestamp: new Date().toISOString(),
      failed: true,
      error: { message: reason, category: 'no_image' },
      geminiUsage: buildUsagePayload({
        model: modelId, bookId, pageId, jobId, durationMs: 0,
        inputTokens: 0, outputTokens: 0, status: 'failed',
        errorMessage: reason, errorCategory: 'no_image',
      }),
    });

    return;
  }

  // Skip if page already has OCR that's newer than this job
  // Prevents waste from stale queue messages re-OCR'ing already-done pages
  // Pass force: true in job config to override (e.g., re-OCR with new prompt)
  if (!job.config?.force && page.ocr?.data && page.ocr?.updated_at && job.created_at) {
    const ocrTime = new Date(page.ocr.updated_at).getTime();
    const jobTime = new Date(job.created_at).getTime();
    if (ocrTime >= jobTime) {
      console.log(`[OCR] Skipping page ${pageId} (OCR already current, ${page.ocr.model || 'unknown'})`);
      // Send a success (no data) to the write queue so completion tracking happens
      await sendWriteResult({
        type: 'ocr',
        bookId, pageId, jobId, targetPageIds,
        timestamp: new Date().toISOString(),
        failed: false,
        // No data — page already has current OCR, just need completion tracking
      });
      return;
    }
  }

  const startTime = Date.now();

  // Fetch prompt from DB (or hardcoded fallback). Custom prompt overrides DB.
  let promptText: string;
  try {
    const promptResult = await getOcrPrompt(customPrompt ? { customText: customPrompt } : undefined);
    promptText = promptResult.text;
  } catch (promptErr) {
    console.error(`[OCR] Failed to fetch prompt from DB (non-fatal), using custom or will fail:`, promptErr);
    if (customPrompt) {
      promptText = customPrompt;
    } else {
      throw promptErr;
    }
  }

  // Snapshot manually-edited content before overwriting
  try {
    await createRevision(pageId, 'ocr', jobId);
  } catch (snapErr) {
    console.error(`[OCR] Snapshot failed for page ${pageId} (non-fatal):`, snapErr);
  }

  try {
    // Get image buffer and MIME type
    const { buffer, mimeType } = await images.fetchBufferWithMimeType(imageUrl);

    console.log(`[OCR] Downloaded image for page ${pageId}, size: ${buffer.length} bytes, type: ${mimeType}`);

    // Perform OCR with resolved prompt
    const ocrResult = await performOCRWithBuffer(
      buffer,
      mimeType,
      promptText,
      undefined, // no previous page context in Lambda worker (pages arrive out of order)
      modelId
    );

    const durationMs = Date.now() - startTime;
    console.log(`[OCR] OCR completed for page ${pageId}, text length: ${ocrResult.text.length}, ${durationMs}ms`);

    // Send result to write queue — Writer Lambda handles all DB writes
    const pageType = extractPageType(ocrResult.text);
    const columns = extractColumns(ocrResult.text);
    const detectedImages = parseDetectedImages(ocrResult.text);
    await sendWriteResult({
      type: 'ocr',
      bookId,
      pageId,
      jobId,
      targetPageIds,
      timestamp: new Date().toISOString(),
      failed: false,
      data: {
        text: ocrResult.text,
        language: job.config.language || 'auto-detect',
        model: modelId,
        promptVersion: PROMPT_VERSION,
        ...(pageType && { pageType }),
        ...(columns && { columns }),
        ...(detectedImages.length > 0 && { detectedImages }),
      },
      geminiUsage: buildUsagePayload({
        model: modelId, bookId, pageId, jobId, durationMs,
        inputTokens: ocrResult.usage.inputTokens,
        outputTokens: ocrResult.usage.outputTokens,
        status: 'success',
      }),
    });

    console.log(`[OCR] Sent OCR result to write queue for page ${pageId}`);
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const classified = classifyError(error);
    console.error(`[OCR] Failed to process page ${pageId} [${classified.category}]:`, error);

    // RECITATION errors: Retry with fallback model
    if (classified.category === 'safety_filter' && error instanceof Error && error.message.includes('RECITATION')) {
      const fallbackModels = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
      const currentModelIndex = fallbackModels.indexOf(modelId);
      const nextModel = fallbackModels[currentModelIndex + 1];

      if (nextModel && currentModelIndex < fallbackModels.length - 1) {
        console.log(`[OCR] RECITATION error on ${modelId}, retrying page ${pageId} with ${nextModel}`);
        try {
          const { buffer, mimeType } = await images.fetchBufferWithMimeType(imageUrl);
          const retryResult = await performOCRWithBuffer(
            buffer,
            mimeType,
            promptText,
            undefined,
            nextModel
          );

          const retryDuration = Date.now() - startTime;
          console.log(`[OCR] Retry succeeded with ${nextModel} for page ${pageId}`);

          // Send retry result to write queue
          const retryPageType = extractPageType(retryResult.text);
          const retryColumns = extractColumns(retryResult.text);
          const retryImages = parseDetectedImages(retryResult.text);
          await sendWriteResult({
            type: 'ocr',
            bookId,
            pageId,
            jobId,
            targetPageIds,
            timestamp: new Date().toISOString(),
            failed: false,
            data: {
              text: retryResult.text,
              language: job.config.language || 'auto-detect',
              model: nextModel,
              promptVersion: PROMPT_VERSION,
              ...(retryPageType && { pageType: retryPageType }),
              ...(retryColumns && { columns: retryColumns }),
              ...(retryImages.length > 0 && { detectedImages: retryImages }),
            },
            geminiUsage: buildUsagePayload({
              model: nextModel, bookId, pageId, jobId, durationMs: retryDuration,
              inputTokens: retryResult.usage.inputTokens,
              outputTokens: retryResult.usage.outputTokens,
              status: 'success',
            }),
          });

          // Exit early - retry succeeded, don't mark as failed
          return;
        } catch (retryError) {
          console.error(`[OCR] Retry with ${nextModel} also failed for page ${pageId}:`, retryError);
          // Fall through to normal error handling
        }
      } else {
        console.log(`[OCR] No more fallback models to try for page ${pageId}`);
      }
    }

    // Send failure to write queue — writer handles logging + job progress
    await sendWriteResult({
      type: 'ocr',
      bookId,
      pageId,
      jobId,
      targetPageIds,
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
