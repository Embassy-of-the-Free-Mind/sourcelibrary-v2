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
import { PROMPT_VERSION } from '@/lib/types/prompts/defaults';
import { images } from '@/lib/api-client/images';
import type { Page } from '@/lib/types/page';
import { logGeminiCall } from '@/lib/gemini-logger';
import { classifyError } from '@/lib/errors';

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
    return;
  }

  // Get image URL with priority fallbacks
  const imageUrl = getPageImageUrl(page);
  if (!imageUrl) {
    console.error(`[OCR] Page ${pageId} has no image URL`);
    await jobs.updateOne(
      { id: jobId },
      {
        $addToSet: { failed_page_ids: pageId },
        $inc: { 'progress.failed': 1 },
        $set: { updated_at: new Date() }
      }
    );
    await checkJobCompletion(db, jobs, pages, jobId, bookId, job.config.page_ids || []);
    return;
  }

  const modelId = job.config.model || DEFAULT_MODEL;
  const startTime = Date.now();

  try {
    // Get image buffer and MIME type
    const { buffer, mimeType } = await images.fetchBufferWithMimeType(imageUrl);

    console.log(`[OCR] Downloaded image for page ${pageId}, size: ${buffer.length} bytes, type: ${mimeType}`);

    // Perform OCR with custom prompt if provided
    const ocrResult = await performOCRWithBuffer(
      buffer,
      mimeType,
      job.config.language || '',
      undefined, // no previous page context in Lambda worker (pages arrive out of order)
      customPrompt,
      modelId
    );

    const durationMs = Date.now() - startTime;
    console.log(`[OCR] OCR completed for page ${pageId}, text length: ${ocrResult.text.length}, ${durationMs}ms`);

    // Save OCR result
    await pages.updateOne(
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
          updated_at: new Date()
        }
      }
    );

    // Log successful AI call
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

    console.log(`[OCR] Saved OCR result for page ${pageId}`);
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const classified = classifyError(error);
    console.error(`[OCR] Failed to process page ${pageId} [${classified.category}]:`, error);

    // Log failed AI call
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

    await jobs.updateOne(
      { id: jobId },
      {
        $addToSet: { failed_page_ids: pageId },
        $inc: { 'progress.failed': 1 },
        $set: { updated_at: new Date() }
      }
    );
  }

  // Always check completion — runs after both success and failure
  await checkJobCompletion(db, jobs, pages, jobId, bookId, job.config.page_ids || []);
}

async function checkJobCompletion(
  db: Awaited<ReturnType<typeof getDb>>,
  jobs: ReturnType<Awaited<ReturnType<typeof getDb>>['collection']>,
  pages: ReturnType<Awaited<ReturnType<typeof getDb>>['collection']>,
  jobId: string,
  bookId: string,
  targetPageIds: string[]
) {
  const completedCount = await pages.countDocuments({
    book_id: bookId,
    id: { $in: targetPageIds },
    'ocr.data': { $exists: true, $nin: [null, ''] }
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
        $unset: { current_job_id: '' }
      }
    );

    console.log(`[OCR] Updated book ${bookId}: pages_ocr = ${totalPagesWithOcr}`);
  }
}
