/**
 * OCR Processor Logic
 *
 * Processes one page at a time for OCR.
 * Used by AWS Lambda in production.
 */

import { getDb } from '@/lib/mongodb';
import type { PageProcessingMessage } from '@/lib/types/sqs';
import { performOCRWithBuffer } from '@/lib/ai';
import { DEFAULT_MODEL } from '@/lib/types/ai-models';
import { PROMPT_VERSION, extractPageType, extractColumns, parseDetectedImages } from '@/lib/types/prompts/defaults';
import { images } from '@/lib/api-client/images';
import type { Page } from '@/lib/types/page';
import { logGeminiCall } from '@/lib/gemini-logger';
import { classifyError } from '@/lib/errors';
import { createSnapshotIfNeeded } from '@/lib/snapshots';
import { getOcrPrompt } from '@/lib/prompts';

/**
 * Get page image URL with priority fallbacks:
 * 1. cropped_photo (result of split detection, most refined)
 * 2. archived_photo (Vercel Blob cached version, fast & reliable)
 * 3. photo (main image URL)
 * 4. photo_original (original before any processing)
 */
function getPageImageUrl(page: Page): string | null {
  return (
    page.cropped_photo ||
    page.archived_photo ||
    page.photo ||
    page.photo_original ||
    null
  );
}

/**
 * Retry a MongoDB operation with exponential backoff.
 * Designed for saving AI results that are expensive to regenerate.
 */
async function retryDbWrite<T>(fn: () => Promise<T>, label: string, maxRetries = 3): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
      console.warn(`[OCR] ${label} failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms:`, (err as Error).message);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('unreachable');
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
    await jobs.updateOne(
      { id: jobId },
      { $addToSet: { failed_page_ids: pageId }, $inc: { 'progress.failed': 1 }, $set: { updated_at: new Date() } }
    );
    await checkJobCompletion(db, jobs, pages, jobId, bookId, targetPageIds);
    return;
  }

  // Get image URL with priority fallbacks
  const imageUrl = getPageImageUrl(page);
  if (!imageUrl || (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://'))) {
    console.error(`[OCR] Page ${pageId} has ${!imageUrl ? 'no image URL' : `non-HTTP image URL: ${imageUrl.substring(0, 100)}`}`);
    await jobs.updateOne(
      { id: jobId },
      {
        $addToSet: { failed_page_ids: pageId },
        $inc: { 'progress.failed': 1 },
        $set: { updated_at: new Date() }
      }
    );
    await checkJobCompletion(db, jobs, pages, jobId, bookId, targetPageIds);
    return;
  }

  const modelId = job.config.model || DEFAULT_MODEL;
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
    await createSnapshotIfNeeded(pageId, 'pre_ocr', jobId);
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

    // Save OCR result (with retry — Gemini tokens are already spent)
    const pageType = extractPageType(ocrResult.text);
    const columns = extractColumns(ocrResult.text);
    const detectedImages = parseDetectedImages(ocrResult.text);
    await retryDbWrite(() => pages.updateOne(
      { id: pageId },
      {
        $set: {
          ocr: {
            data: ocrResult.text,
            language: job.config.language || 'auto-detect',
            model: modelId,
            updated_at: new Date(),
            source: 'ai',
            prompt_version: PROMPT_VERSION
          },
          ...(pageType && { page_type: pageType }),
          ...(columns && { columns }),
          ...(detectedImages.length > 0 && { detected_images: detectedImages }),
          updated_at: new Date()
        }
      }
    ), `save OCR for page ${pageId}`);

    // Log successful AI call (non-blocking - don't let logging failures crash the worker)
    try {
      await logGeminiCall({
        type: 'ocr',
        mode: 'realtime',
        model: modelId,
        book_id: bookId,
        page_ids: [pageId],
        input_tokens: ocrResult.usage.inputTokens,
        output_tokens: ocrResult.usage.outputTokens,
        status: 'success',
        job_id: jobId,
        duration_ms: durationMs,
        prompt_version: PROMPT_VERSION,
        endpoint: 'worker/ocr',
      });
    } catch (logError) {
      console.error(`[OCR] Failed to log success for page ${pageId}:`, logError);
    }

    console.log(`[OCR] Saved OCR result for page ${pageId}`);
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

          // Save retry result (with retry — Gemini tokens are already spent)
          const retryPageType = extractPageType(retryResult.text);
          const retryColumns = extractColumns(retryResult.text);
          const retryImages = parseDetectedImages(retryResult.text);
          await retryDbWrite(() => pages.updateOne(
            { id: pageId },
            {
              $set: {
                ocr: {
                  data: retryResult.text,
                  language: job.config.language || 'auto-detect',
                  model: nextModel,
                  updated_at: new Date(),
                  source: 'ai',
                  prompt_version: PROMPT_VERSION
                },
                ...(retryPageType && { page_type: retryPageType }),
                ...(retryColumns && { columns: retryColumns }),
                ...(retryImages.length > 0 && { detected_images: retryImages }),
                updated_at: new Date()
              }
            }
          ), `save OCR retry for page ${pageId}`);

          // Log successful retry
          try {
            await logGeminiCall({
              type: 'ocr',
              mode: 'realtime',
              model: nextModel,
              book_id: bookId,
              page_ids: [pageId],
              input_tokens: retryResult.usage.inputTokens,
              output_tokens: retryResult.usage.outputTokens,
              status: 'success',
              job_id: jobId,
              duration_ms: retryDuration,
              prompt_version: PROMPT_VERSION,
              endpoint: 'worker/ocr',
            });
          } catch (logError) {
            console.error(`[OCR] Failed to log retry success for page ${pageId}:`, logError);
          }

          // Exit early - retry succeeded, don't mark as failed
          await checkJobCompletion(db, jobs, pages, jobId, bookId, targetPageIds);
          return;
        } catch (retryError) {
          console.error(`[OCR] Retry with ${nextModel} also failed for page ${pageId}:`, retryError);
          // Fall through to normal error handling
        }
      } else {
        console.log(`[OCR] No more fallback models to try for page ${pageId}`);
      }
    }

    // Log failed AI call (non-blocking - don't let logging failures prevent status updates)
    try {
      await logGeminiCall({
        type: 'ocr',
        mode: 'realtime',
        model: modelId,
        book_id: bookId,
        page_ids: [pageId],
        input_tokens: 0,
        output_tokens: 0,
        status: 'failed',
        error_message: classified.message,
        error_category: classified.category,
        job_id: jobId,
        duration_ms: durationMs,
        prompt_version: PROMPT_VERSION,
        endpoint: 'worker/ocr',
      });
    } catch (logError) {
      console.error(`[OCR] Failed to log error for page ${pageId}:`, logError);
    }

    // CRITICAL: Update job status even if logging failed
    try {
      await jobs.updateOne(
        { id: jobId },
        {
          $addToSet: { failed_page_ids: pageId },
          $inc: { 'progress.failed': 1 },
          $set: { updated_at: new Date() }
        }
      );
    } catch (updateError) {
      console.error(`[OCR] CRITICAL: Failed to update job status for ${jobId}:`, updateError);
      // Re-throw so Lambda can retry
      throw updateError;
    }
  }

  // Always check completion — runs after both success and failure
  try {
    await checkJobCompletion(db, jobs, pages, jobId, bookId, targetPageIds);
  } catch (completionError) {
    console.error(`[OCR] Failed to check job completion for ${jobId}:`, completionError);
    // Don't re-throw - page processing is done, this is just status tracking
  }
}

async function checkJobCompletion(
  db: Awaited<ReturnType<typeof getDb>>,
  jobs: ReturnType<Awaited<ReturnType<typeof getDb>>['collection']>,
  pages: ReturnType<Awaited<ReturnType<typeof getDb>>['collection']>,
  jobId: string,
  bookId: string,
  targetPageIds: string[]
) {
  // Count pages where OCR has been performed (including empty results from blank pages)
  const completedCount = await pages.countDocuments({
    book_id: bookId,
    id: { $in: targetPageIds },
    'ocr.data': { $exists: true, $ne: null }
  });

  await jobs.updateOne(
    { id: jobId },
    {
      $set: {
        'progress.completed': completedCount,
        updated_at: new Date()
      }
    }
  );

  console.log(`[OCR] Progress: ${completedCount}/${targetPageIds.length}`);

  const updatedJob = await jobs.findOne({ id: jobId });
  const failedCount = updatedJob?.progress?.failed || 0;
  const totalAttempted = completedCount + failedCount;

  if (totalAttempted >= targetPageIds.length) {
    const finalStatus = failedCount > 0 ? 'completed_with_errors' : 'completed';
    console.log(`[OCR] Job ${jobId} ${finalStatus} (${completedCount} succeeded, ${failedCount} failed)`);
    await jobs.updateOne(
      { id: jobId },
      {
        $set: {
          status: finalStatus,
          completed_at: new Date(),
          updated_at: new Date()
        }
      }
    );

    // Update book's pages_ocr count with actual count from pages collection
    const totalPagesWithOcr = await pages.countDocuments({
      book_id: bookId,
      'ocr.data': { $exists: true, $ne: '' }
    });

    await db.collection('books').updateOne(
      { id: bookId },
      {
        $set: {
          pages_ocr: totalPagesWithOcr,
          updated_at: new Date()
        },
        $unset: { job: '' }
      }
    );

    console.log(`[OCR] Updated book ${bookId}: pages_ocr = ${totalPagesWithOcr}`);
  }
}
