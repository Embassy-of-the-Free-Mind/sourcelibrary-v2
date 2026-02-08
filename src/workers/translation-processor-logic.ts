import { getDb } from '@/lib/mongodb';
import type { PageProcessingMessage } from '@/lib/types/sqs';
import { performTranslation } from '@/lib/ai';
import { DEFAULT_MODEL, PROMPT_VERSION } from '@/lib/types';

/**
 * Translation Processor - processes one page at a time
 *
 * Flow:
 * 1. Check if job is cancelled
 * 2. Get previous page's translation for context
 * 3. Translate current page with context
 * 4. Update progress counter
 * 5. Check if job is complete
 */
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
    return;
  }

  // Check if page has OCR
  if (!page.ocr?.data) {
    console.error(`[TRANS] Page ${pageId} has no OCR data`);
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
      job.config.model || DEFAULT_MODEL
    );

    // Save translation
    await pages.updateOne(
      { id: pageId },
      {
        $set: {
          translation: {
            data: translationResult.text,
            language: 'English',
            model: job.config.model || DEFAULT_MODEL,
            updated_at: new Date(),
            source: 'ai',
            prompt_version: PROMPT_VERSION
          },
          updated_at: new Date()
        }
      }
    );

    console.log(`[TRANS] Completed page ${pageId}`);
  } catch (error) {
    console.error(`[TRANS] Failed to process page ${pageId}:`, error);
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
    'translation.data': { $exists: true, $nin: [null, ''] }
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

  console.log(`[TRANS] Progress: ${completedCount}/${targetPageIds.length}`);

  // Check if all pages have been attempted (completed + failed)
  const updatedJob = await jobs.findOne({ id: jobId });
  const failedCount = updatedJob?.progress?.failed || 0;
  const totalAttempted = completedCount + failedCount;

  if (totalAttempted >= targetPageIds.length) {
    const finalStatus = failedCount > 0 ? 'partial' : 'completed';
    console.log(`[TRANS] Job ${jobId} ${finalStatus} (${completedCount} succeeded, ${failedCount} failed)`);
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
