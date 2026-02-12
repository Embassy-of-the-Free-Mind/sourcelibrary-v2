import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { nanoid } from 'nanoid';
import { getOcrPrompt } from '@/lib/prompts';
import { logGeminiCall } from '@/lib/gemini-logger';
import { images } from '@/lib/api-client';
import { getPageImageUrl } from '@/lib/utils';
import { createBatchJobInline, type BatchRequest } from '@/lib/gemini-batch';
import { PROMPT_VERSION } from '@/lib/types/prompts/defaults';
import { DEFAULT_BATCH_MODEL } from '@/lib/types/ai-models';
import type { BatchJob } from '@/lib/types/batch-job';
import type { JobType, JobStatus } from '@/lib/types/job';
import type { Book } from '@/lib/types/book';
import type { Page } from '@/lib/types/page';

const BATCH_SIZE = 10; // Pages per Gemini batch (Gemini Batch API: 20MB per file, 2GB total limit)

/**
 * POST /api/books/[id]/batch-ocr-multi
 *
 * Multi-batch OCR processor with parent-child job architecture.
 * Handles large books by splitting into multiple Gemini batches (10 pages each).
 *
 * Benefits:
 * - 50% cheaper than real-time API
 * - Handles books of any size (splits into manageable chunks)
 * - Progress tracking via parent-child jobs
 * - Results in ~24 hours
 *
 * Body:
 *   pageIds: string[] - Array of page IDs to process
 *   action: 'ocr' - Type of processing (currently OCR only)
 *   overwriteMode: boolean - If true, reprocess pages with existing OCR
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const body = await request.json();
    const { pageIds, action, overwriteMode = false } = body;

    // Validate request
    if (!pageIds || !Array.isArray(pageIds) || pageIds.length === 0) {
      return NextResponse.json({ error: 'pageIds array is required' }, { status: 400 });
    }

    const jobType: JobType = 'ocr';
    if (action !== jobType) {
      return NextResponse.json(
        { error: 'action must be "ocr"' },
        { status: 400 }
      );
    }

    const db = await getDb();
    const book = await db.collection<Book>('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    // Build filter: pages must have images, optionally filter by OCR status
    let query: any = {
      book_id: bookId,
      id: { $in: pageIds },
      // Page must have an image
      $or: [
        { photo: { $exists: true, $ne: null } },
        { photo_original: { $exists: true, $ne: null } }
      ]
    };

    // If not overwriting, only include pages without OCR
    if (!overwriteMode) {
      query = {
        book_id: bookId,
        id: { $in: pageIds },
        $and: [
          {
            $or: [
              { photo: { $exists: true, $ne: null } },
              { photo_original: { $exists: true, $ne: null } }
            ]
          },
          {
            $or: [
              { 'ocr.data': { $exists: false } },
              { 'ocr.data': null },
              { 'ocr.data': '' }
            ]
          }
        ]
      };
    }

    // Get pages to process
    const pages = await db.collection<Page>('pages')
      .find(query)
      .sort({ page_number: 1 })
      .toArray();

    if (pages.length === 0) {
      return NextResponse.json(
        {
          error: 'No pages to process',
          message: overwriteMode
            ? 'No pages found with images'
            : 'All selected pages already have OCR data'
        },
        { status: 404 }
      );
    }

    // Create parent job
    const parentJobId = nanoid();
    const pendingStatus: JobStatus = 'pending';    

    const parentJob: BatchJob = {
      id: parentJobId,
      type: jobType,
      book_id: bookId,
      book_title: book.title,
      total_pages: pages.length,
      child_job_ids: [],
      progress: {
        completed: 0,
        failed: 0,
        pending: pages.length,
        total: pages.length
      },
      status: pendingStatus,
      created_at: new Date(),
      updated_at: new Date()
    };

    await db.collection('batch_jobs').insertOne(parentJob);

    // Split pages into chunks of BATCH_SIZE
    const chunks: Page[][] = [];
    for (let i = 0; i < pages.length; i += BATCH_SIZE) {
      chunks.push(pages.slice(i, i + BATCH_SIZE));
    }

    const childJobIds: string[] = [];
    const language = book.language || 'auto-detect';

    // Get OCR prompt
    const promptResult = await getOcrPrompt(language);
    const prompt = promptResult.text;

    // Submit each chunk as a Gemini batch
    for (const chunk of chunks) {
      const childJobId = nanoid();

      // Build batch requests for this chunk
      const batchRequests: BatchRequest[] = [];
      for (const page of chunk) {
        const imageUrl = getPageImageUrl(page);
        if (!imageUrl) {
          console.warn(`No image URL for page ${page.page_number} (${page.id})`);
          continue;
        }

        try {
          const result = await images.fetchBase64(imageUrl, { includeMimeType: true });
          const imageData = typeof result === 'string'
            ? { data: result, mimeType: 'image/jpeg' }
            : { data: result.base64, mimeType: result.mimeType };

          batchRequests.push({
            key: page.id,
            request: {
              contents: [{
                parts: [
                  { text: prompt },
                  {
                    inlineData: {
                      mimeType: imageData.mimeType,
                      data: imageData.data
                    }
                  }
                ]
              }]
            }
          });
        } catch (error) {
          console.error(`Failed to fetch image for page ${page.page_number}:`, error);
          continue;
        }
      }

      if (batchRequests.length === 0) {
        console.warn(`No valid images in chunk ${childJobId}`);
        continue;
      }

      // Submit to Gemini Batch API using helper
      const batchJob = await createBatchJobInline(
        DEFAULT_BATCH_MODEL,
        batchRequests,
        `ocr-${bookId}-${childJobId}-${Date.now()}`
      );

      // Create child job record
      const childJob: BatchJob = {
        id: childJobId,
        parent_job_id: parentJobId,
        job_name: batchJob.name,
        type: jobType,
        book_id: bookId,
        page_ids: batchRequests.map(r => r.key),
        page_count: batchRequests.length,
        status: pendingStatus,
        model: DEFAULT_BATCH_MODEL,
        language,
        prompt_version: PROMPT_VERSION,
        force: overwriteMode,
        created_at: new Date(),
        updated_at: new Date()
      };

      await db.collection('batch_jobs').insertOne(childJob);
      childJobIds.push(childJobId);

      // Log batch submission
      await logGeminiCall({
        type: jobType,
        mode: 'batch',
        model: DEFAULT_BATCH_MODEL,
        book_id: bookId,
        book_title: book.title,
        page_ids: batchRequests.map(r => r.key),
        page_count: batchRequests.length,
        batch_job_id: childJobId,
        gemini_job_name: batchJob.name,
        input_tokens: 0,
        output_tokens: 0,
        status: 'submitted',
        endpoint: '/api/books/[id]/batch-ocr-multi',
      });
    }

    // Update parent with child IDs
    await db.collection('batch_jobs').updateOne(
      { id: parentJobId },
      { $set: { child_job_ids: childJobIds, updated_at: new Date() } }
    );

    // Set active batch job on book document (prevents duplicate submissions)
    await db.collection('books').updateOne(
      { id: bookId },
      { $set: { job: { type: 'batch', job_id: parentJobId } } }
    );

    return NextResponse.json({
      success: true,
      parentJobId,
      childJobIds,
      totalBatches: chunks.length,
      totalPages: pages.length
    });

  } catch (error) {
    console.error('Batch multi-job error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create batch jobs' },
      { status: 500 }
    );
  }
}
