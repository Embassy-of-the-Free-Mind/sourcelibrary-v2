import { getDb } from '@/lib/mongodb';
import type { PageProcessingMessage } from '@/lib/types/sqs';
import type { ImageExtractionWriteResult, GeminiUsagePayload } from '@/lib/types/sqs';
import type { Page } from '@/lib/types/page';
import { extractWithGemini, type BookContext } from '@/lib/image-extraction';
import { getImageExtractionPrompt } from '@/lib/prompts';
import { DEFAULT_MODEL } from '@/lib/types/ai-models';
import { PROMPT_VERSION } from '@/lib/types/prompts/defaults';
import { classifyError } from '@/lib/errors';
import { sendWriteResult } from '@/lib/sqs-client';

/**
 * Image Extraction Processor - processes one page at a time
 *
 * WRITE QUEUE: This worker does NOT write results to MongoDB directly.
 * Instead, it sends results (including pre-built gallery docs) to the
 * write-results SQS queue. The Writer Lambda handles all DB writes
 * with capped concurrency to prevent MongoDB connection storms.
 *
 * Flow:
 * 1. Check if job is cancelled
 * 2. Get page image URL (with priority fallbacks)
 * 3. Extract images with AI vision
 * 4. Build gallery docs (using book metadata read at this point)
 * 5. Send everything to write queue
 */

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
    type: 'extract_images',
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
    endpoint: 'worker/image-extraction',
  };
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

  if (job.status === 'completed' || job.status === 'completed_with_errors' || job.status === 'failed') {
    console.log(`[IMG-EXTRACT] Job ${jobId} already ${job.status}, skipping stale message for page ${pageId}`);
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
    console.error(`[IMG-EXTRACT] Page ${pageId} not found`);
    await sendWriteResult({
      type: 'image_extraction',
      bookId, pageId, jobId, targetPageIds,
      timestamp: new Date().toISOString(),
      failed: true,
      error: { message: 'Page not found', category: 'no_data' },
    });
    return;
  }

  // Get image URL with priority fallbacks
  const imageUrl = getPageImageUrl(page);
  if (!imageUrl) {
    const reason = isArchiveFailed(page.archived_photo)
      ? `archived_photo="${page.archived_photo}" — source URL dead`
      : 'no image URL on page';
    console.error(`[IMG-EXTRACT] Page ${pageId}: ${reason}`);

    // Send failure to write queue
    await sendWriteResult({
      type: 'image_extraction',
      bookId, pageId, jobId, targetPageIds,
      timestamp: new Date().toISOString(),
      failed: true,
      error: { message: reason, category: 'no_image' },
      geminiUsage: buildUsagePayload({
        model: job.config?.model || DEFAULT_MODEL, bookId, pageId, jobId, durationMs: 0,
        inputTokens: 0, outputTokens: 0, status: 'failed',
        errorMessage: reason, errorCategory: 'no_image',
      }),
    });

    return;
  }

  // Skip if page already has image extraction results from this job or newer
  // Prevents waste from stale queue messages re-extracting already-done pages
  // Pass force: true in job config to override
  const pageDoc = page as Page & { image_extraction_updated_at?: Date };
  if (!job.config?.force && pageDoc.image_extraction_updated_at && job.created_at) {
    const extractTime = new Date(pageDoc.image_extraction_updated_at).getTime();
    const jobTime = new Date(job.created_at).getTime();
    if (extractTime >= jobTime) {
      console.log(`[IMG-EXTRACT] Skipping page ${pageId} (image extraction already current)`);
      await sendWriteResult({
        type: 'image_extraction',
        bookId, pageId, jobId, targetPageIds,
        timestamp: new Date().toISOString(),
        failed: false,
      });
      return;
    }
  }

  const modelId = job.config.model || DEFAULT_MODEL;
  const startTime = Date.now();

  // Fetch book metadata for context-aware extraction
  const book = await db.collection('books').findOne(
    { id: bookId },
    { projection: { title: 1, author: 1, year: 1, language: 1, 'tags.tradition': 1, 'tags.domain': 1 } }
  );
  const bookContext: BookContext | undefined = book ? {
    title: book.title,
    author: book.author,
    year: book.year,
    language: book.language,
    subjects: [...(book.tags?.tradition || []), ...(book.tags?.domain || [])].filter(Boolean),
  } : undefined;

  // Get versioned prompt from DB (or hardcoded fallback)
  const promptResult = await getImageExtractionPrompt();

  try {
    // Pass OCR data if available — helps model place bounding boxes accurately
    const ocrData = (page.ocr?.data && typeof page.ocr.data === 'string') ? page.ocr.data : undefined;
    const result = await extractWithGemini(imageUrl, modelId, {
      returnUsage: true, ocrData, bookContext, promptText: promptResult.text,
    });
    const durationMs = Date.now() - startTime;

    // Attach job_id and prompt provenance to each detection
    const imagesWithJob = (result.images as unknown as Array<Record<string, unknown>>).map((img) => ({
      ...img,
      job_id: jobId,
      prompt: promptResult.reference,
    }));

    // Build gallery docs now (we have book metadata in memory) — writer just inserts them
    const galleryDocs = await buildGalleryDocs(db, pageId, bookId, page, imagesWithJob as any);

    // Send result to write queue
    await sendWriteResult({
      type: 'image_extraction',
      bookId, pageId, jobId, targetPageIds,
      timestamp: new Date().toISOString(),
      failed: false,
      data: {
        detectedImages: imagesWithJob,
        promptVersion: PROMPT_VERSION,
        galleryDocs,
      },
      geminiUsage: buildUsagePayload({
        model: modelId, bookId, pageId, jobId, durationMs,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        status: 'success',
      }),
    });

    console.log(`[IMG-EXTRACT] Completed page ${pageId}: ${result.images.length} images detected, ${durationMs}ms`);
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const classified = classifyError(error);
    console.error(`[IMG-EXTRACT] Failed to process page ${pageId} [${classified.category}]:`, error);

    // Send failure to write queue
    await sendWriteResult({
      type: 'image_extraction',
      bookId, pageId, jobId, targetPageIds,
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

/**
 * Build gallery_images documents for the write queue.
 * Reads book metadata for denormalization, but does NOT write to MongoDB.
 * The Writer Lambda performs the actual deleteMany + insertMany.
 */
async function buildGalleryDocs(
  db: Awaited<ReturnType<typeof getDb>>,
  pageId: string,
  bookId: string,
  page: Page,
  images: Page['detected_images']
): Promise<Array<Record<string, unknown>>> {
  if (!images || images.length === 0) return [];

  try {
    // Fetch book metadata for denormalization
    const book = await db.collection('books').findOne(
      { id: bookId },
      { projection: { display_title: 1, title: 1, author: 1, year: 1, language: 1 } }
    );

    const imageUrl = page.cropped_photo || page.archived_photo || page.photo_original || page.photo || '';

    const docs = images
      .map((img, idx) => {
        if (!img.bbox) return null;
        if (!['vision_model', 'manual', 'ocr_tag'].includes(img.detection_source || '')) return null;
        if ((img.gallery_quality || 0) < 0.5) return null;

        return {
          id: `${pageId}-${idx}`,
          page_id: pageId,
          book_id: bookId,
          page_number: page.page_number,
          detection_index: idx,
          image_url: imageUrl,
          thumbnail_url: img.thumbnail_url || null,
          extracted_url: img.extracted_url || null,
          description: img.description || '',
          type: img.type || null,
          bbox: img.bbox,
          rotation: img.rotation || null,
          gallery_quality: img.gallery_quality || 0,
          confidence: img.confidence || null,
          museum_description: img.museum_description || null,
          detection_source: img.detection_source || null,
          metadata: img.metadata || null,
          book_title: book?.display_title || book?.title || 'Unknown',
          book_author: book?.author || null,
          book_year: book?.year || null,
          book_language: book?.language || null,
          book_rank: 0,
          updated_at: new Date(),
        };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);

    return docs;
  } catch (error) {
    console.error(`[IMG-EXTRACT] Failed to build gallery docs for page ${pageId}:`, error);
    return [];
  }
}
