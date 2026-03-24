/**
 * Write Processor Logic
 *
 * Performs all MongoDB writes for AI worker results.
 * Dispatches by message type (ocr, translation, image_extraction).
 *
 * This Lambda is the ONLY writer during batch processing.
 * Reserved concurrency = 50 caps simultaneous DB connections.
 *
 * Operations per message type:
 * - OCR: pages.updateOne, gemini_usage.insertOne, checkJobCompletion
 * - Translation: gemini_usage.insertOne, checkJobCompletion
 *   (the translation text itself is written directly by the translation worker
 *    to preserve FIFO context chain ordering)
 * - Image extraction: pages.updateOne, gallery upsert, gemini_usage.insertOne, checkJobCompletion
 */

import { getDb } from '@/lib/mongodb';
import { logGeminiCall } from '@/lib/gemini-logger';
import { retryDbWrite } from '@/lib/retry-utils';
import { checkJobCompletion } from '@/lib/job-completion';
import type { PageJobType } from '@/lib/types/job';
import type {
  WriteResultMessage,
  OcrWriteResult,
  TranslationWriteResult,
  ImageExtractionWriteResult,
  GeminiUsagePayload,
} from '@/lib/types/sqs';

const LOG_PREFIX = '[WRITER]';

export async function processWriteResult(message: WriteResultMessage): Promise<void> {
  console.log(`${LOG_PREFIX} Processing ${message.type} result for page ${message.pageId} (job ${message.jobId})`);

  const db = await getDb();

  switch (message.type) {
    case 'ocr':
      await processOcrResult(db, message);
      break;
    case 'translation':
      await processTranslationResult(db, message);
      break;
    case 'image_extraction':
      await processImageExtractionResult(db, message);
      break;
    default:
      console.error(`${LOG_PREFIX} Unknown message type: ${(message as WriteResultMessage).type}`);
      return;
  }
}

// ─── OCR ───────────────────────────────────────────────────────────────────

async function processOcrResult(db: Awaited<ReturnType<typeof getDb>>, message: OcrWriteResult): Promise<void> {
  const { pageId, jobId, bookId, targetPageIds, failed } = message;
  const jobs = db.collection('jobs');

  if (failed) {
    // Record failure in job progress
    await retryDbWrite(() => jobs.updateOne(
      { id: jobId },
      {
        $addToSet: { failed_page_ids: pageId },
        $inc: { 'progress.failed': 1 },
        $set: { updated_at: new Date() }
      }
    ), `record OCR failure for page ${pageId}`, 3, LOG_PREFIX);
  } else if (message.data) {
    // Save OCR result to page
    const { text, language, model, promptVersion, pageType, columns, scriptType, detectedImages } = message.data;
    await retryDbWrite(() => db.collection('pages').updateOne(
      { id: pageId },
      {
        $set: {
          ocr: {
            data: text,
            language,
            model,
            updated_at: new Date(),
            source: 'ai',
            prompt_version: promptVersion
          },
          ...(pageType && { page_type: pageType }),
          ...(columns && { columns }),
          ...(scriptType && { script_type: scriptType }),
          ...(detectedImages && detectedImages.length > 0 && { detected_images: detectedImages }),
          updated_at: new Date()
        }
      }
    ), `save OCR for page ${pageId}`, 3, LOG_PREFIX);
  }

  // Log Gemini usage (non-blocking)
  await logUsageSafe(message.geminiUsage);

  // Check if job is complete
  await safeCheckCompletion(db, jobId, bookId, targetPageIds, 'ocr');
}

// ─── Translation ───────────────────────────────────────────────────────────

async function processTranslationResult(db: Awaited<ReturnType<typeof getDb>>, message: TranslationWriteResult): Promise<void> {
  const { pageId, jobId, bookId, targetPageIds, failed } = message;
  const jobs = db.collection('jobs');

  if (failed) {
    await retryDbWrite(() => jobs.updateOne(
      { id: jobId },
      {
        $addToSet: { failed_page_ids: pageId },
        $inc: { 'progress.failed': 1 },
        $set: { updated_at: new Date() }
      }
    ), `record translation failure for page ${pageId}`, 3, LOG_PREFIX);
  }
  // Note: translation text is written directly by the translation worker (FIFO context chain).
  // This message only handles logging + completion tracking.

  // Log Gemini usage (non-blocking)
  await logUsageSafe(message.geminiUsage);

  // Check if job is complete
  await safeCheckCompletion(db, jobId, bookId, targetPageIds, 'translation');
}

// ─── Image Extraction ──────────────────────────────────────────────────────

async function processImageExtractionResult(db: Awaited<ReturnType<typeof getDb>>, message: ImageExtractionWriteResult): Promise<void> {
  const { pageId, jobId, bookId, targetPageIds, failed } = message;
  const jobs = db.collection('jobs');

  if (failed) {
    await retryDbWrite(() => jobs.updateOne(
      { id: jobId },
      {
        $addToSet: { failed_page_ids: pageId },
        $inc: { 'progress.failed': 1 },
        $set: { updated_at: new Date() }
      }
    ), `record image extraction failure for page ${pageId}`, 3, LOG_PREFIX);
  } else if (message.data) {
    const { detectedImages, promptVersion, galleryDocs } = message.data;

    // Save detected images to page
    // Only overwrite if the new run found images — don't wipe existing OCR-detected images with an empty array
    const imageSetFields: Record<string, unknown> = {
      image_extraction_updated_at: new Date(),
      image_extraction_prompt_version: promptVersion,
      updated_at: new Date()
    };
    if (detectedImages && detectedImages.length > 0) {
      imageSetFields.detected_images = detectedImages;
    }
    await retryDbWrite(() => db.collection('pages').updateOne(
      { id: pageId },
      { $set: imageSetFields }
    ), `save image extraction for page ${pageId}`, 3, LOG_PREFIX);

    // Upsert gallery images (non-fatal — gallery is a cache)
    if (galleryDocs && galleryDocs.length > 0) {
      try {
        const galleryImages = db.collection('gallery_images');
        await galleryImages.deleteMany({ page_id: pageId });
        await galleryImages.insertMany(galleryDocs);
        console.log(`${LOG_PREFIX} Upserted ${galleryDocs.length} gallery images for page ${pageId}`);
      } catch (error) {
        console.error(`${LOG_PREFIX} Failed to upsert gallery images for page ${pageId}:`, error);
      }
    }
  }

  // Log Gemini usage (non-blocking)
  await logUsageSafe(message.geminiUsage);

  // Check if job is complete
  await safeCheckCompletion(db, jobId, bookId, targetPageIds, 'image_extraction');
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Log Gemini usage without crashing on failure.
 */
async function logUsageSafe(usage: GeminiUsagePayload | undefined): Promise<void> {
  if (!usage) return;
  try {
    await logGeminiCall(usage);
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to log Gemini usage:`, error);
  }
}

/**
 * Check job completion without crashing the writer.
 * Completion check failures are non-fatal — the next message for this job will retry.
 */
async function safeCheckCompletion(
  db: Awaited<ReturnType<typeof getDb>>,
  jobId: string,
  bookId: string,
  targetPageIds: string[],
  jobType: PageJobType
): Promise<void> {
  try {
    await checkJobCompletion({
      db,
      jobId,
      bookId,
      targetPageIds,
      jobType,
      logPrefix: LOG_PREFIX,
    });
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to check job completion for ${jobId}:`, error);
  }
}
