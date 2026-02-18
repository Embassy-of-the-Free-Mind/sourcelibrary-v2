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
import { verifyCronAuth } from '@/lib/cron-auth';
import type { Page } from '@/lib/types/page';

export const maxDuration = 300;

const TARGET_MODEL = 'gemini-3-flash-preview';
const SKIP_MODELS = ['manual', 'manual-correction'];
const BATCH_SIZE = 10;       // Pages per Gemini batch submission
const BOOKS_PER_RUN = 3;     // Books per invocation (image downloads are slow)
const PAGES_PER_BOOK = 80;   // Max pages per book per run (must fit in 300s timeout)

/**
 * GET /api/admin/bulk-reocr
 *
 * Submits Gemini Batch API jobs to re-OCR pages that were processed
 * with older models. Targets ALL books with old-model OCR pages.
 *
 * Query params:
 *   offset=N      Skip first N eligible books (for pagination)
 *   limit=N       Override BOOKS_PER_RUN
 *   book_id=ID    Process a single book
 *   dry_run=true  Show what would be submitted
 *
 * Auth: CRON_SECRET bearer token
 * Results collected by /api/cron/process-batches (every 2h)
 */
export async function GET(request: NextRequest) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const startTime = Date.now();
  const { searchParams } = new URL(request.url);
  const offset = parseInt(searchParams.get('offset') || '0', 10);
  const limit = parseInt(searchParams.get('limit') || String(BOOKS_PER_RUN), 10);
  const singleBookId = searchParams.get('book_id');
  const dryRun = searchParams.get('dry_run') === 'true';

  try {
    const db = await getDb();

    // Backpressure: check active batch jobs (only very recent ones, not stale)
    const recentCutoff = new Date(Date.now() - 6 * 60 * 60 * 1000); // 6h
    const activeJobs = await db.collection('batch_jobs').countDocuments({
      status: { $in: ['pending', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] },
      created_at: { $gte: recentCutoff },
    });
    if (activeJobs >= 500 && !singleBookId) {
      return NextResponse.json({
        success: true, skipped: true,
        reason: `${activeJobs} active batch jobs, waiting for results`,
      });
    }

    // Find books with old-model OCR pages (all books, not just opened)
    const bookFilter: Record<string, unknown> = { deleted: { $ne: true } };
    if (singleBookId) {
      bookFilter.id = singleBookId;
    }

    // Exclude books with recent active batch jobs
    const activeBatchBookIds = await db.collection('batch_jobs').distinct('book_id', {
      status: { $in: ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] },
      created_at: { $gte: recentCutoff },
    });
    if (activeBatchBookIds.length > 0 && !singleBookId) {
      bookFilter.id = { $nin: activeBatchBookIds };
    }

    const books = await db.collection('books').find(bookFilter, {
      projection: {
        _id: 0, id: 1, title: 1, display_title: 1,
        language: 1, original_language: 1, read_count: 1,
      }
    })
      .sort({ read_count: -1, pages_ocr: -1 })
      .skip(offset)
      .limit(limit + 50) // Fetch extra since some will have 0 eligible pages
      .toArray();

    const submitted: Array<{
      bookId: string; title: string; parentJobId: string;
      batches: number; pages: number;
    }> = [];
    const skipped: string[] = [];

    for (const book of books) {
      if (submitted.length >= limit) break;

      // Find pages with old OCR models
      const eligiblePages = await db.collection('pages').find(
        {
          book_id: book.id,
          'ocr.data': { $exists: true, $ne: '' },
          'ocr.model': { $exists: true, $ne: TARGET_MODEL, $nin: SKIP_MODELS },
          $or: [
            { photo: { $exists: true, $ne: null } },
            { photo_original: { $exists: true, $ne: null } }
          ]
        },
        {
          projection: {
            _id: 0, id: 1, page_number: 1,
            photo: 1, photo_original: 1, archived_photo: 1,
            cropped_photo: 1, crop: 1,
          }
        }
      ).sort({ page_number: 1 }).limit(PAGES_PER_BOOK).toArray();

      if (eligiblePages.length === 0) {
        continue;
      }

      const label = (book.display_title || book.title || '').substring(0, 60);

      if (dryRun) {
        submitted.push({
          bookId: book.id,
          title: label,
          parentJobId: 'dry-run',
          batches: Math.ceil(eligiblePages.length / BATCH_SIZE),
          pages: eligiblePages.length,
        });
        continue;
      }

      // Get OCR prompt for this book's language
      const language = book.original_language || book.language || '';
      const promptResult = await getOcrPrompt(language);
      const prompt = promptResult.text;

      // Create parent batch_job
      const parentJobId = nanoid();
      await db.collection('batch_jobs').insertOne({
        id: parentJobId,
        type: 'ocr',
        book_id: book.id,
        book_title: book.title,
        total_pages: eligiblePages.length,
        child_job_ids: [] as string[],
        progress: {
          completed: 0, failed: 0,
          pending: eligiblePages.length, total: eligiblePages.length,
        },
        status: 'pending',
        model: DEFAULT_BATCH_MODEL,
        language,
        prompt_version: PROMPT_VERSION,
        force: true,
        created_at: new Date(),
        updated_at: new Date(),
      });

      // Submit in chunks
      const childJobIds: string[] = [];
      let bookPagesSubmitted = 0;

      for (let j = 0; j < eligiblePages.length; j += BATCH_SIZE) {
        const chunk = eligiblePages.slice(j, j + BATCH_SIZE);
        const batchRequests: BatchRequest[] = [];

        for (const page of chunk) {
          const imageUrl = getPageImageUrl(page as unknown as Parameters<typeof getPageImageUrl>[0]);
          if (!imageUrl) continue;

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
                    { inlineData: { mimeType: imageData.mimeType, data: imageData.data } },
                  ],
                }],
              },
            });
          } catch {
            console.warn(`[bulk-reocr] Failed to fetch image for page ${page.page_number}`);
          }
        }

        if (batchRequests.length === 0) continue;

        try {
          const childJobId = nanoid();
          const batchJob = await createBatchJobInline(
            DEFAULT_BATCH_MODEL,
            batchRequests,
            `reocr-${book.id}-${childJobId}`
          );

          await db.collection('batch_jobs').insertOne({
            id: childJobId,
            parent_job_id: parentJobId,
            job_name: batchJob.name,
            type: 'ocr',
            book_id: book.id,
            page_ids: batchRequests.map(r => r.key),
            page_count: batchRequests.length,
            status: 'pending',
            model: DEFAULT_BATCH_MODEL,
            language,
            prompt_version: PROMPT_VERSION,
            force: true,
            created_at: new Date(),
            updated_at: new Date(),
          });

          childJobIds.push(childJobId);
          bookPagesSubmitted += batchRequests.length;

          await logGeminiCall({
            type: 'ocr',
            mode: 'batch',
            model: DEFAULT_BATCH_MODEL,
            book_id: book.id,
            book_title: book.title,
            page_ids: batchRequests.map(r => r.key),
            page_count: batchRequests.length,
            batch_job_id: childJobId,
            gemini_job_name: batchJob.name,
            input_tokens: 0,
            output_tokens: 0,
            status: 'submitted',
            endpoint: '/api/admin/bulk-reocr',
          });
        } catch (error) {
          console.error(`[bulk-reocr] Batch submit error for ${label}:`, error);
          skipped.push(`${label}: ${error instanceof Error ? error.message : 'unknown'}`);
        }
      }

      // Update parent with child IDs
      await db.collection('batch_jobs').updateOne(
        { id: parentJobId },
        { $set: { child_job_ids: childJobIds, updated_at: new Date() } }
      );

      // Set active batch job on book
      await db.collection('books').updateOne(
        { id: book.id },
        { $set: { job: { type: 'batch', job_id: parentJobId } } }
      );

      submitted.push({
        bookId: book.id,
        title: label,
        parentJobId,
        batches: childJobIds.length,
        pages: bookPagesSubmitted,
      });
    }

    const totalPages = submitted.reduce((sum, s) => sum + s.pages, 0);

    return NextResponse.json({
      success: true,
      dryRun,
      activeJobsBefore: activeJobs,
      booksSubmitted: submitted.length,
      totalPages,
      estimatedCost: `$${(totalPages * 0.00079).toFixed(2)}`,
      submitted,
      skipped: skipped.length > 0 ? skipped : undefined,
      offset,
      nextOffset: offset + submitted.length,
      duration_ms: Date.now() - startTime,
    });
  } catch (error) {
    console.error('[admin/bulk-reocr] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    );
  }
}
