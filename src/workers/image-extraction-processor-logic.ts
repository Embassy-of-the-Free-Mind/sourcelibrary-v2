import { getDb } from '@/lib/mongodb';
import type { PageProcessingMessage } from '@/lib/types/sqs';
import type { Page } from '@/lib/types/page';
import { extractWithGemini } from '@/lib/image-extraction';
import { DEFAULT_MODEL } from '@/lib/types/ai-models';
import { PROMPT_VERSION } from '@/lib/types/prompts/defaults';
import { logGeminiCall } from '@/lib/gemini-logger';
import { classifyError } from '@/lib/errors';

/**
 * Image Extraction Processor - processes one page at a time
 *
 * Flow:
 * 1. Check if job is cancelled
 * 2. Get page image URL (with priority fallbacks)
 * 3. Extract images with AI vision
 * 4. Save results to page
 * 5. Update progress counter
 * 6. Check if job is complete
 */

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

export async function processImageExtractionPage(message: PageProcessingMessage) {
  const { bookId, pageId, jobId } = message;

  console.log(`[IMG-EXTRACT] Processing page ${pageId} for job ${jobId}`);

  const db = await getDb();
  const jobs = db.collection('jobs');
  const pages = db.collection('pages');

  // Check if job is cancelled
  const job = await jobs.findOne({ id: jobId });
  if (!job) {
    console.error(`[IMG-EXTRACT] Job ${jobId} not found`);
    return;
  }

  if (job.status === 'cancelled') {
    console.log(`[IMG-EXTRACT] Job ${jobId} is cancelled, skipping page ${pageId}`);
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
    console.error(`[IMG-EXTRACT] Page ${pageId} not found`);
    return;
  }

  // Get image URL with priority fallbacks
  const imageUrl = getPageImageUrl(page);
  if (!imageUrl) {
    console.error(`[IMG-EXTRACT] Page ${pageId} has no image URL`);
    await jobs.updateOne(
      { id: jobId },
      {
        $addToSet: { failed_page_ids: pageId },
        $inc: { 'progress.failed': 1 },
        $set: { updated_at: new Date() }
      }
    );
    return;
  }

  const modelId = job.config.model || DEFAULT_MODEL;
  const startTime = Date.now();

  try {
    // Extract images with AI vision (with usage tracking)
    const result = await extractWithGemini(imageUrl, modelId, { returnUsage: true });
    const durationMs = Date.now() - startTime;

    // Save results to page
    await pages.updateOne(
      { id: pageId },
      {
        $set: {
          detected_images: result.images,
          image_extraction_updated_at: new Date(),
          image_extraction_prompt_version: PROMPT_VERSION,
          updated_at: new Date()
        }
      }
    );

    // Log successful AI call
    await logGeminiCall({
      type: 'extract_images',
      mode: 'realtime',
      model: modelId,
      book_id: bookId,
      page_ids: [pageId],
      input_tokens: result.usage.inputTokens,
      output_tokens: result.usage.outputTokens,
      status: 'success',
      job_id: jobId,
      duration_ms: durationMs,
      prompt_version: PROMPT_VERSION,
      endpoint: 'worker/image-extraction',
    });

    console.log(`[IMG-EXTRACT] Completed page ${pageId}: ${result.images.length} images detected, ${durationMs}ms`);
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const classified = classifyError(error);
    console.error(`[IMG-EXTRACT] Failed to process page ${pageId} [${classified.category}]:`, error);

    // Log failed AI call
    await logGeminiCall({
      type: 'extract_images',
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
      endpoint: 'worker/image-extraction',
    });

    await jobs.updateOne(
      { id: jobId },
      {
        $addToSet: { failed_page_ids: pageId },
        $inc: { 'progress.failed': 1 },
        $set: { updated_at: new Date() }
      }
    );
    return;
  }

  // Update progress counter
  const targetPageIds = job.config.page_ids || [];
  const completedCount = await pages.countDocuments({
    book_id: bookId,
    id: { $in: targetPageIds },
    detected_images: { $exists: true }
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

  console.log(`[IMG-EXTRACT] Progress: ${completedCount}/${targetPageIds.length}`);

  // Check if all pages have been attempted (completed + failed)
  const updatedJob = await jobs.findOne({ id: jobId });
  const failedCount = updatedJob?.progress?.failed || 0;
  const totalAttempted = completedCount + failedCount;

  if (totalAttempted >= targetPageIds.length) {
    const finalStatus = failedCount > 0 ? 'partial' : 'completed';
    console.log(`[IMG-EXTRACT] Job ${jobId} ${finalStatus} (${completedCount} succeeded, ${failedCount} failed)`);
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

    // Clear current_job_id from book
    await db.collection('books').updateOne(
      { id: bookId },
      { $unset: { current_job_id: '' } }
    );
  }
}
