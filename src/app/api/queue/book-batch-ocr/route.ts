import { handleCallback } from '@vercel/queue';
import { getDb } from '@/lib/mongodb';
import { getOcrPrompt } from '@/lib/prompts';
import { logGeminiCall } from '@/lib/gemini-logger';
import { images } from '@/lib/api-client';
import { getPageImageUrl } from '@/lib/utils';
import { createBatchJobInline, type BatchRequest } from '@/lib/gemini-batch';
import { enqueueBatchMonitor } from '@/lib/api-client/queues.server';
import type { BookBatchOcrPayload } from '@/lib/api-client/types/queues';

/**
 * Queue Handler: book-batch-ocr
 *
 * Processes a book's pages via Gemini Batch API:
 * 1. Receives all page IDs for a book
 * 2. Chunks into 50-page batches (optimal size for quality & API limits)
 * 3. For each chunk:
 *    - Fetches page images
 *    - Prepares Gemini Batch API request
 *    - Submits to Gemini
 *    - Stores batch_job record with chunk metadata
 *    - Enqueues to batch-monitor queue
 */

export const maxDuration = 300; // 5 minute timeout

const CHUNK_SIZE = 50; // Pages per Gemini batch

// Fetch image as base64
async function fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const result = await images.fetchBase64(url, { includeMimeType: true });
    if (typeof result === 'string') {
      return { data: result, mimeType: 'image/jpeg' };
    }
    return { data: result.base64, mimeType: result.mimeType };
  } catch (error) {
    console.error('Failed to fetch image:', url, error);
    return null;
  }
}

export const POST = handleCallback({
  'book-batch-ocr': {
    'default': async (message) => {
      const payload = message as BookBatchOcrPayload;
      const { bookId, dbJobId, pageIds, model, language } = payload;

      console.log(`[book-batch-ocr] Starting OCR for book ${bookId}: ${pageIds.length} pages`);

      const db = await getDb();

      // Get book info
      const book = await db.collection('books').findOne({ id: bookId });
      if (!book) {
        throw new Error(`Book ${bookId} not found`);
      }

      // Fetch all pages
      const pages = await db.collection('pages')
        .find({ id: { $in: pageIds } })
        .sort({ page_number: 1 })
        .toArray();

      if (pages.length === 0) {
        throw new Error(`No pages found for book ${bookId}`);
      }

      // Split into chunks
      const chunks: Array<{ chunkIndex: number; pageIds: string[]; pages: any[] }> = [];
      for (let i = 0; i < pages.length; i += CHUNK_SIZE) {
        const chunkPages = pages.slice(i, i + CHUNK_SIZE);
        chunks.push({
          chunkIndex: Math.floor(i / CHUNK_SIZE),
          pageIds: chunkPages.map(p => p.id),
          pages: chunkPages
        });
      }

      const totalChunks = chunks.length;
      console.log(`[book-batch-ocr] Book ${bookId}: ${pages.length} pages → ${totalChunks} chunks`);

      // Get OCR prompt
      const ocrPromptResult = await getOcrPrompt(language);
      const prompt = ocrPromptResult.text;

      // Process each chunk
      const submittedChunks = [];
      for (const chunk of chunks) {
        console.log(`[book-batch-ocr] Processing chunk ${chunk.chunkIndex + 1}/${totalChunks} (${chunk.pages.length} pages)`);

        // Prepare batch requests for this chunk
        const batchRequests: BatchRequest[] = [];
        for (const page of chunk.pages) {
          const imageUrl = getPageImageUrl(page);
          const image = await fetchImageAsBase64(imageUrl);

          if (!image) {
            console.warn(`[book-batch-ocr] Failed to fetch image for page ${page.page_number}`);
            continue;
          }

          batchRequests.push({
            key: page.id, // Use page ID as key for matching results
            request: {
              contents: [{
                parts: [
                  { text: prompt },
                  {
                    inlineData: {
                      mimeType: image.mimeType,
                      data: image.data
                    }
                  }
                ]
              }]
            }
          });
        }

        if (batchRequests.length === 0) {
          console.warn(`[book-batch-ocr] Chunk ${chunk.chunkIndex} has no valid images, skipping`);
          continue;
        }

        // Submit to Gemini Batch API using existing utility
        const batchJob = await createBatchJobInline(
          model,
          batchRequests,
          `ocr-${bookId}-chunk${chunk.chunkIndex}`
        );

        console.log(`[book-batch-ocr] Submitted chunk ${chunk.chunkIndex}: ${batchJob.name}`);

        // Store batch job with chunk metadata
        await db.collection('batch_jobs').insertOne({
          gemini_job_name: batchJob.name,
          book_id: bookId,
          db_job_id: dbJobId,
          type: 'ocr',
          model,
          language,
          page_ids: batchRequests.map(r => r.key),
          page_count: batchRequests.length,
          chunk_index: chunk.chunkIndex,
          total_chunks: totalChunks,
          status: batchJob.state,
          created_at: new Date(),
          updated_at: new Date(),
        });

        // Log batch job submission
        await logGeminiCall({
          type: 'ocr',
          mode: 'batch',
          model,
          book_id: bookId,
          book_title: book?.title,
          page_ids: batchRequests.map(r => r.key),
          page_count: batchRequests.length,
          batch_job_id: batchJob.name,
          gemini_job_name: batchJob.name,
          input_tokens: 0, // Not available until job completes
          output_tokens: 0,
          status: 'submitted',
          endpoint: '/api/queue/book-batch-ocr',
        });

        // Enqueue to batch-monitor with initial delay
        // TESTING: 2 minutes | PRODUCTION: 6 hours (uncomment line below, comment out testing line)
        await enqueueBatchMonitor({
          geminiBatchJobId: batchJob.name,
          jobType: 'ocr',
          bookId,
          dbJobId,
          submittedAt: new Date().toISOString(),
          attemptCount: 0
        }, 2 * 60 * 1000); // TESTING: 2 minutes
        // }, 6 * 60 * 60 * 1000); // PRODUCTION: 6 hours

        submittedChunks.push({
          chunkIndex: chunk.chunkIndex,
          batchJobId: batchJob.name,
          pageCount: batchRequests.length
        });
      }

      console.log(`[book-batch-ocr] Completed for book ${bookId}: ${submittedChunks.length}/${totalChunks} chunks submitted`);
    }
  }
});
