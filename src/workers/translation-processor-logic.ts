import { getDb } from '@/lib/mongodb';
import type { PageProcessingMessage } from '@/lib/types/sqs';
import { performTranslation } from '@/lib/ai';
import { DEFAULT_MODEL, PROMPT_VERSION } from '@/lib/types';
import { logGeminiCall } from '@/lib/gemini-logger';
import { classifyError } from '@/lib/errors';

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
    await jobs.updateOne(
      { id: jobId },
      { $addToSet: { failed_page_ids: pageId }, $inc: { 'progress.failed': 1 }, $set: { updated_at: new Date() } }
    );
    await checkJobCompletion(db, jobs, pages, jobId, bookId, targetPageIds);
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
    await checkJobCompletion(db, jobs, pages, jobId, bookId, targetPageIds);
    return;
  }

  const modelId = job.config.model || DEFAULT_MODEL;
  const startTime = Date.now();

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

    // Save translation
    await pages.updateOne(
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
          updated_at: new Date()
        }
      }
    );

    // Log successful AI call
    await logGeminiCall({
      type: 'translate',
      mode: 'realtime',
      model: modelId,
      book_id: bookId,
      page_ids: [pageId],
      input_tokens: translationResult.usage.inputTokens,
      output_tokens: translationResult.usage.outputTokens,
      status: 'success',
      job_id: jobId,
      duration_ms: durationMs,
      prompt_version: PROMPT_VERSION,
      endpoint: 'worker/translation',
    });

    console.log(`[TRANS] Completed page ${pageId}, ${durationMs}ms`);
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const classified = classifyError(error);
    console.error(`[TRANS] Failed to process page ${pageId} [${classified.category}]:`, error);

    // Log failed AI call
    await logGeminiCall({
      type: 'translate',
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
      endpoint: 'worker/translation',
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
  await checkJobCompletion(db, jobs, pages, jobId, bookId, targetPageIds);
}

async function checkJobCompletion(
  db: Awaited<ReturnType<typeof getDb>>,
  jobs: ReturnType<Awaited<ReturnType<typeof getDb>>['collection']>,
  pages: ReturnType<Awaited<ReturnType<typeof getDb>>['collection']>,
  jobId: string,
  bookId: string,
  targetPageIds: string[]
) {
  // Count pages where translation has been performed (including empty results)
  const completedCount = await pages.countDocuments({
    book_id: bookId,
    id: { $in: targetPageIds },
    'translation.data': { $exists: true, $ne: null }
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

  const updatedJob = await jobs.findOne({ id: jobId });
  const failedCount = updatedJob?.progress?.failed || 0;
  const totalAttempted = completedCount + failedCount;

  if (totalAttempted >= targetPageIds.length) {
    const finalStatus = failedCount > 0 ? 'completed_with_errors' : 'completed';
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

    // Update book's pages_translated count with actual count from pages collection
    const totalPagesWithTranslation = await pages.countDocuments({
      book_id: bookId,
      'translation.data': { $exists: true, $ne: '' }
    });

    await db.collection('books').updateOne(
      { id: bookId },
      {
        $set: {
          pages_translated: totalPagesWithTranslation,
          last_translation_at: new Date(),
          updated_at: new Date()
        },
        $unset: { job: '' }
      }
    );

    console.log(`[TRANS] Updated book ${bookId}: pages_translated = ${totalPagesWithTranslation}`);
  }
}
