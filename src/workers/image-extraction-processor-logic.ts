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
    await jobs.updateOne(
      { id: jobId },
      { $addToSet: { failed_page_ids: pageId }, $inc: { 'progress.failed': 1 }, $set: { updated_at: new Date() } }
    );
    await checkJobCompletion(db, jobs, pages, jobId, bookId, targetPageIds);
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
    await checkJobCompletion(db, jobs, pages, jobId, bookId, targetPageIds);
    return;
  }

  const modelId = job.config.model || DEFAULT_MODEL;
  const startTime = Date.now();

  try {
    // Pass OCR data if available — helps model place bounding boxes accurately
    const ocrData = (page.ocr?.data && typeof page.ocr.data === 'string') ? page.ocr.data : undefined;
    const result = await extractWithGemini(imageUrl, modelId, { returnUsage: true, ocrData });
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

    // Upsert into gallery_images materialized collection
    await upsertGalleryImages(db, pageId, bookId, page, result.images as any);

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

  const updatedJob = await jobs.findOne({ id: jobId });
  const failedCount = updatedJob?.progress?.failed || 0;
  const totalAttempted = completedCount + failedCount;

  if (totalAttempted >= targetPageIds.length) {
    const finalStatus = failedCount > 0 ? 'completed_with_errors' : 'completed';
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

    // Clear job from book
    await db.collection('books').updateOne(
      { id: bookId },
      { $unset: { job: '' } }
    );
  }
}

/**
 * Upsert detected images into the gallery_images materialized collection.
 * Runs after each page's image extraction succeeds.
 */
async function upsertGalleryImages(
  db: Awaited<ReturnType<typeof getDb>>,
  pageId: string,
  bookId: string,
  page: Page,
  images: Page['detected_images']
) {
  if (!images || images.length === 0) return;

  try {
    // Fetch book metadata for denormalization
    const book = await db.collection('books').findOne(
      { id: bookId },
      { projection: { display_title: 1, title: 1, author: 1, year: 1, language: 1 } }
    );

    const imageUrl = page.cropped_photo || page.photo_original || page.photo || '';
    const galleryImages = db.collection('gallery_images');

    // Remove old gallery_images for this page (in case image count changed)
    await galleryImages.deleteMany({ page_id: pageId });

    // Build docs for qualifying images
    const docs = images
      .map((img, idx) => {
        // Only materialize images with bbox, valid source, and quality >= 0.5
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
          book_rank: 0, // Will be recomputed by periodic sync
          updated_at: new Date(),
        };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);

    if (docs.length > 0) {
      await galleryImages.insertMany(docs);
    }

    console.log(`[IMG-EXTRACT] Upserted ${docs.length} gallery images for page ${pageId}`);
  } catch (error) {
    // Non-fatal — gallery_images is a cache that will be refreshed by cron
    console.error(`[IMG-EXTRACT] Failed to upsert gallery images for page ${pageId}:`, error);
  }
}
