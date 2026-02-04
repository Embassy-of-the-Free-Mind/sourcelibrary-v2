/**
 * OCR Processor Logic (Standalone)
 *
 * Core OCR processing logic that can be called from:
 * - AWS Lambda handler (production)
 * - Test endpoints (local development)
 *
 * No Lambda or SQS dependencies - pure business logic.
 */

import { getDb } from '@/lib/mongodb';
import type { PageOcrMessage } from '@/lib/types/sqs';
import { performOCRWithBuffer } from '@/lib/ai';
import { DEFAULT_MODEL } from '@/lib/types';
import { images } from '@/lib/api-client/images';

export async function processOcrPage(msg: PageOcrMessage): Promise<void> {
  const { bookId, pageId, dbJobId } = msg;

  const db = await getDb();
  const pages = db.collection('pages');
  const jobs = db.collection('jobs');

  // Get page record
  const page = await pages.findOne({ id: pageId });
  if (!page) {
    throw new Error(`Page ${pageId} not found`);
  }

  // Idempotent: skip if already has OCR
  if (page.ocr?.data) {
    console.log(`[OCR] Page ${pageId} already has OCR, skipping`);
    return;
  }

  console.log(`[OCR] Processing page ${pageId} from book ${bookId}`);

  // Download image
  const imageUrl = page.archived_photo || page.photo;
  if (!imageUrl) {
    throw new Error(`Page ${pageId} has no image URL`);
  }

  // Get image buffer and MIME type
  const { buffer, mimeType } = await images.fetchBufferWithMimeType(imageUrl);

  console.log(`[OCR] Downloaded image for page ${pageId}, size: ${buffer.length} bytes, type: ${mimeType}`);

  // Perform OCR (uses API key rotation internally)
  const ocrResult = await performOCRWithBuffer(buffer, mimeType, 'Latin');

  console.log(`[OCR] OCR completed for page ${pageId}, text length: ${ocrResult.text.length}`);

  // Save OCR result
  await pages.updateOne(
    { id: pageId },
    {
      $set: {
        ocr: {
          data: ocrResult.text,
          language: 'Latin',
          model: DEFAULT_MODEL,
          updated_at: new Date(),
          source: 'ai'
        },
        updated_at: new Date()
      }
    }
  );

  // Atomic progress update and completion check
  const job = await jobs.findOneAndUpdate(
    { id: dbJobId },
    {
      $inc: { 'progress.ocr_completed': 1 },
      $set: { updated_at: new Date() }
    },
    { returnDocument: 'after' }
  );

  if (!job) {
    throw new Error(`Job ${dbJobId} not found`);
  }

  const ocrCompleted = job.progress.ocr_completed || 0;
  const total = job.progress.total || 0;

  console.log(`[OCR] Progress: ${ocrCompleted}/${total} pages for job ${dbJobId}`);

  // Check if this was the last page for OCR phase
  if (ocrCompleted >= total) {
    console.log(`[OCR] All OCR complete for book ${bookId}, job ${dbJobId}`);

    // In production with SQS: trigger translation phase via message
    // In local testing: translation will be triggered manually via test endpoint
    const inProduction = process.env.SQS_BOOK_PROCESSING_QUEUE_URL;

    if (inProduction) {
      // Production: send SQS message to trigger translation
      const { sendMessage, QUEUE_URLS } = await import('@/lib/sqs-client');
      await sendMessage({
        queueUrl: QUEUE_URLS.bookProcessing,
        message: {
          bookId,
          dbJobId,
          phase: 'translation'
        },
        messageGroupId: bookId
      });
      console.log(`[OCR] Triggered translation phase for book ${bookId}`);
    } else {
      // Local testing: just update job status, translation will be called manually
      await jobs.updateOne(
        { id: dbJobId },
        { $set: { status: 'ocr' } } // Keep as 'ocr' - test will manually trigger translation
      );
      console.log(`[OCR] Local mode: OCR complete, ready for translation. Call process-book with phase=translation`);
    }
  }
}
