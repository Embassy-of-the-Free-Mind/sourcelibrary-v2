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
import { images } from '@/lib/api-client/images';
import type { Page } from '@/lib/types/page';

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
    return;
  }

  try {
    // Get image buffer and MIME type
    const { buffer, mimeType } = await images.fetchBufferWithMimeType(imageUrl);

    console.log(`[OCR] Downloaded image for page ${pageId}, size: ${buffer.length} bytes, type: ${mimeType}`);

    // Perform OCR with custom prompt if provided
    const ocrResult = await performOCRWithBuffer(
      buffer,
      mimeType,
      job.config.language || 'Latin',
      job.config.model || DEFAULT_MODEL,
      customPrompt
    );

    console.log(`[OCR] OCR completed for page ${pageId}, text length: ${ocrResult.text.length}`);

    // Save OCR result
    await pages.updateOne(
      { id: pageId },
      {
        $set: {
          ocr: {
            data: ocrResult.text,
            language: job.config.language || 'Latin',
            model: job.config.model || DEFAULT_MODEL,
            updated_at: new Date(),
            source: 'ai'
          },
          updated_at: new Date()
        }
      }
    );

    console.log(`[OCR] Saved OCR result for page ${pageId}`);
  } catch (error) {
    console.error(`[OCR] Failed to process page ${pageId}:`, error);
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

  // Check if job is complete
  if (completedCount >= targetPageIds.length) {
    console.log(`[OCR] Job ${jobId} complete`);
    await jobs.updateOne(
      { id: jobId },
      {
        $set: {
          status: 'completed',
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
