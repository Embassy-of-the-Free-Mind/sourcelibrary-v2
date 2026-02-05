/**
 * Book Processor Logic (Standalone)
 *
 * Core book processing logic that can be called from:
 * - AWS Lambda handler (production)
 * - Test endpoints (local development)
 *
 * No Lambda or SQS dependencies - pure business logic.
 */

import { getDb } from '@/lib/mongodb';
import type { BookProcessingMessage } from '@/lib/types/sqs';
import { performTranslation } from '@/lib/ai';
import { DEFAULT_MODEL } from '@/lib/types';

const MAX_DURATION = 240000; // 4 minutes safety margin
const PAGES_PER_CHECKPOINT = 50; // OCR enqueueing
const TRANSLATION_PAGES_PER_CHECKPOINT = 10; // Translation processing

export async function processBook(msg: BookProcessingMessage): Promise<void> {
  const { bookId, dbJobId, phase, startPageIndex, retryPageIds } = msg;

  const db = await getDb();
  const job = await db.collection('jobs').findOne({ id: dbJobId });

  if (!job) {
    throw new Error(`Job ${dbJobId} not found`);
  }

  // Determine current phase
  const ocrCompleted = job.progress.ocr_completed || 0;
  const total = job.progress.total || 0;
  const currentPhase = phase || (ocrCompleted < total ? 'ocr' : 'translation');

  console.log(`[BOOK] Processing book ${bookId}, phase: ${currentPhase}, job: ${dbJobId}`);

  if (currentPhase === 'ocr') {
    await handleOcrPhase(bookId, dbJobId, startPageIndex || 0, retryPageIds);
  } else {
    await handleTranslationPhase(bookId, dbJobId, retryPageIds);
  }
}

async function handleOcrPhase(
  bookId: string,
  dbJobId: string,
  startPageIndex: number,
  retryPageIds?: string[]
): Promise<void> {
  const db = await getDb();
  const pages = db.collection('pages');
  const jobs = db.collection('jobs');
  const books = db.collection('books');
  const startTime = Date.now();

  console.log(`[BOOK-OCR] Starting OCR phase for book ${bookId}, startPageIndex: ${startPageIndex}`);

  // Find pages needing OCR
  const query: any = { book_id: bookId };
  if (retryPageIds) {
    query.id = { $in: retryPageIds };
  } else {
    // Match pages with no OCR data (undefined, null, or empty string)
    query.$or = [
      { 'ocr.data': { $exists: false } },
      { 'ocr.data': null },
      { 'ocr.data': '' }
    ];
  }

  const pagesToProcess = await pages.find(query).sort({ page_number: 1 }).toArray();

  console.log(`[BOOK-OCR] Found ${pagesToProcess.length} pages needing OCR`);

  if (pagesToProcess.length === 0) {
    console.log(`[BOOK-OCR] No pages need OCR, moving to translation phase`);
    await handleTranslationPhase(bookId, dbJobId);
    return;
  }

  // First invocation: initialize job
  if (startPageIndex === 0) {
    await jobs.updateOne(
      { id: dbJobId },
      {
        $set: {
          status: 'ocr',
          'progress.total': pagesToProcess.length,
          'progress.ocr_completed': 0,
          updated_at: new Date()
        }
      }
    );

    await books.updateOne(
      { id: bookId },
      { $set: { current_job_id: dbJobId } }
    );

    console.log(`[BOOK-OCR] Initialized job ${dbJobId} with ${pagesToProcess.length} pages`);
  }

  // In production with SQS: enqueue pages to page-ocr-queue
  // In local testing: process pages directly
  const localTestMode = process.env.LOCAL_TEST_MODE === 'true';
  const inProduction = !localTestMode && process.env.SQS_PAGE_OCR_QUEUE_URL;

  if (inProduction) {
    // Production: enqueue to SQS with checkpointing
    const { sendMessage, QUEUE_URLS } = await import('@/lib/sqs-client');
    const endIndex = Math.min(startPageIndex + PAGES_PER_CHECKPOINT, pagesToProcess.length);

    for (let i = startPageIndex; i < endIndex; i++) {
      // Check timeout
      if (Date.now() - startTime > MAX_DURATION) {
        console.log(`[BOOK-OCR] Timeout approaching at page ${i}, checkpointing`);
        await sendMessage({
          queueUrl: QUEUE_URLS.bookProcessing,
          message: {
            bookId,
            dbJobId,
            phase: 'ocr',
            startPageIndex: i
          },
          messageGroupId: bookId
        });
        return;
      }

      const page = pagesToProcess[i];
      await sendMessage({
        queueUrl: QUEUE_URLS.pageOcr,
        message: {
          bookId,
          pageId: page.id,
          dbJobId
        }
      });
    }

    console.log(`[BOOK-OCR] Enqueued pages ${startPageIndex + 1}-${endIndex} of ${pagesToProcess.length}`);

    // Check if more pages remain
    if (endIndex < pagesToProcess.length) {
      await sendMessage({
        queueUrl: QUEUE_URLS.bookProcessing,
        message: {
          bookId,
          dbJobId,
          phase: 'ocr',
          startPageIndex: endIndex
        },
        messageGroupId: bookId
      });
      console.log(`[BOOK-OCR] Re-enqueued self for next checkpoint`);
    }

    console.log(`[BOOK-OCR] OCR enqueueing complete, exiting (workers will trigger translation)`);
  } else {
    // Local testing: process OCR pages directly and sequentially
    console.log(`[BOOK-OCR] Local mode: processing ${pagesToProcess.length} pages directly`);

    const { processOcrPage } = await import('./ocr-processor-logic');

    for (let i = startPageIndex; i < pagesToProcess.length; i++) {
      const page = pagesToProcess[i];
      console.log(`[BOOK-OCR] Processing page ${i + 1}/${pagesToProcess.length}: ${page.id}`);

      try {
        await processOcrPage({
          bookId,
          pageId: page.id,
          dbJobId
        });
      } catch (error) {
        console.error(`[BOOK-OCR] Failed to process page ${page.id}:`, error);
        // Track failure
        await jobs.updateOne(
          { id: dbJobId },
          { $addToSet: { failed_page_ids: page.id } }
        );
      }
    }

    console.log(`[BOOK-OCR] Local mode: All OCR pages processed, moving to translation`);
    await handleTranslationPhase(bookId, dbJobId);
  }
}

async function handleTranslationPhase(
  bookId: string,
  dbJobId: string,
  retryPageIds?: string[]
): Promise<void> {
  const db = await getDb();
  const pages = db.collection('pages');
  const jobs = db.collection('jobs');
  const startTime = Date.now();

  console.log(`[BOOK-TRANS] Starting translation phase for book ${bookId}`);

  // Find pages needing translation
  const query: any = { book_id: bookId };

  if (retryPageIds) {
    query.id = { $in: retryPageIds };
    // Must have OCR data to translate
    query['ocr.data'] = { $exists: true, $nin: [null, ''] };
  } else {
    // Must have OCR data
    query['ocr.data'] = { $exists: true, $nin: [null, ''] };
    // And missing translation (undefined, null, or empty string)
    query.$or = [
      { 'translation.data': { $exists: false } },
      { 'translation.data': null },
      { 'translation.data': '' }
    ];
  }

  const pagesToTranslate = await pages
    .find(query)
    .sort({ page_number: 1 })
    .toArray();

  console.log(`[BOOK-TRANS] Found ${pagesToTranslate.length} pages needing translation`);

  if (pagesToTranslate.length === 0) {
    console.log(`[BOOK-TRANS] No pages need translation, completing job`);
    await handleCompletion(bookId, dbJobId);
    return;
  }

  // Update job status
  await jobs.updateOne(
    { id: dbJobId },
    { $set: { status: 'translation', updated_at: new Date() } }
  );

  // Process pages sequentially with context
  // Note: startPageIndex tracks cumulative progress, but pagesToTranslate is a fresh query of remaining pages
  // So we always process from index 0 of this array, taking up to TRANSLATION_PAGES_PER_CHECKPOINT items
  const pagesToProcess = Math.min(TRANSLATION_PAGES_PER_CHECKPOINT, pagesToTranslate.length);

  for (let i = 0; i < pagesToProcess; i++) {
    // Check timeout
    if (Date.now() - startTime > MAX_DURATION) {
      console.log(`[BOOK-TRANS] Timeout approaching at page ${i}, checkpointing`);

      const localTestMode = process.env.LOCAL_TEST_MODE === 'true';
      const inProduction = !localTestMode && process.env.SQS_BOOK_PROCESSING_QUEUE_URL;
      if (inProduction) {
        const { sendMessage, QUEUE_URLS } = await import('@/lib/sqs-client');
        await sendMessage({
          queueUrl: QUEUE_URLS.bookProcessing,
          message: {
            bookId,
            dbJobId,
            phase: 'translation',
            startPageIndex: i
          },
          messageGroupId: bookId
        });
      }
      return;
    }

    const page = pagesToTranslate[i];

    console.log(`[BOOK-TRANS] Translating page ${i + 1}/${pagesToTranslate.length}: ${page.id}`);

    try {
      // Check if page already has translation (for counter logic)
      const hadTranslation = !!page.translation?.data;

      // Get context from previous page
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

      // Translate (uses API key rotation internally)
      const translationResult = await performTranslation(
        page.ocr.data,
        context,
        'English',
        DEFAULT_MODEL
      );

      // Save translation (always save, even if exists - allows fixing bad translations)
      await pages.updateOne(
        { id: page.id },
        {
          $set: {
            translation: {
              data: translationResult.text,
              language: 'English',
              model: DEFAULT_MODEL,
              updated_at: new Date(),
              source: 'ai'
            },
            updated_at: new Date()
          }
        }
      );

      // Only increment counter if this is a NEW translation (not a retry/fix)
      if (!hadTranslation) {
        await jobs.updateOne(
          { id: dbJobId },
          {
            $inc: { 'progress.translation_completed': 1 },
            $set: { updated_at: new Date() }
          }
        );
        console.log(`[BOOK-TRANS] Completed page ${page.id} (new translation)`);
      } else {
        console.log(`[BOOK-TRANS] Re-translated page ${page.id} (counter not incremented)`);
      }
    } catch (error) {
      console.error(`[BOOK-TRANS] Failed to translate page ${page.id}:`, error);
      // Track failure
      await jobs.updateOne(
        { id: dbJobId },
        { $addToSet: { failed_page_ids: page.id } }
      );
    }
  }

  // Check if more pages remain
  if (pagesToProcess < pagesToTranslate.length) {
    console.log(`[BOOK-TRANS] Checkpoint reached, ${pagesToTranslate.length - pagesToProcess} pages remaining`);

    const localTestMode = process.env.LOCAL_TEST_MODE === 'true';
    const inProduction = !localTestMode && process.env.SQS_BOOK_PROCESSING_QUEUE_URL;

    if (inProduction) {
      console.log(`[BOOK-TRANS] Sending checkpoint message to SQS for book ${bookId}`);
      try {
        const { sendMessage, QUEUE_URLS } = await import('@/lib/sqs-client');
        const result = await sendMessage({
          queueUrl: QUEUE_URLS.bookProcessing,
          message: {
            bookId,
            dbJobId,
            phase: 'translation'
          },
          messageGroupId: bookId,
          deduplicationId: `${bookId}-translation-${Date.now()}` // Unique ID prevents deduplication
        });
        console.log(`[BOOK-TRANS] Checkpoint message sent successfully:`, result);
      } catch (error) {
        console.error(`[BOOK-TRANS] Failed to send checkpoint message:`, error);
        throw error;
      }
    } else {
      console.log(`[BOOK-TRANS] Local mode: continuing recursively`);
      // Local mode: continue processing recursively
      await handleTranslationPhase(bookId, dbJobId, retryPageIds);
    }
  } else {
    // All pages done
    await handleCompletion(bookId, dbJobId);
  }
}

async function handleCompletion(bookId: string, dbJobId: string): Promise<void> {
  const db = await getDb();
  const jobs = db.collection('jobs');
  const books = db.collection('books');

  console.log(`[BOOK] Completing job ${dbJobId} for book ${bookId}`);

  const job = await jobs.findOne({ id: dbJobId });
  const hasFailures = (job?.failed_page_ids?.length || 0) > 0;

  await jobs.updateOne(
    { id: dbJobId },
    {
      $set: {
        status: hasFailures ? 'partial' : 'completed',
        completed_at: new Date(),
        updated_at: new Date()
      }
    }
  );

  // Clear current_job_id
  await books.updateOne(
    { id: bookId },
    { $unset: { current_job_id: '' } }
  );

  console.log(`[BOOK] Job ${dbJobId} ${hasFailures ? 'partially' : 'fully'} completed`);
}
