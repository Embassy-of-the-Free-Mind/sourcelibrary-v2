import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { nanoid } from 'nanoid';
import type { Job } from '@/lib/types';

export const maxDuration = 300;

/**
 * POST /api/batch-jobs/process-all
 *
 * Creates batch jobs for all books that need OCR or translation.
 * Each job uses Gemini Batch API (50% cost savings).
 *
 * Query params:
 * - type: 'ocr' | 'translate' | 'both' (default: 'both')
 * - limit: max books to process (default: 10)
 * - book_id: specific book to process (optional)
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'both';
    const limit = parseInt(searchParams.get('limit') || '10', 10);
    const specificBookId = searchParams.get('book_id');

    const db = await getDb();
    const results: {
      ocr_jobs: Array<{ book_id: string; book_title: string; job_id: string; pages: number }>;
      translate_jobs: Array<{ book_id: string; book_title: string; job_id: string; pages: number }>;
      skipped: string[];
      errors: string[];
    } = {
      ocr_jobs: [],
      translate_jobs: [],
      skipped: [],
      errors: [],
    };

    // Get books to process
    const bookQuery = specificBookId ? { id: specificBookId } : {};
    const books = await db.collection('books')
      .find(bookQuery)
      .limit(specificBookId ? 1 : limit * 2) // Get extra to account for skips
      .toArray();

    let processedCount = 0;

    for (const book of books) {
      if (processedCount >= limit) break;

      const bookId = book.id || book._id?.toString();
      const bookTitle = book.title || 'Untitled';

      // Get pages for this book
      const pages = await db.collection('pages')
        .find({ book_id: bookId })
        .toArray();

      if (pages.length === 0) {
        results.skipped.push(`${bookTitle}: no pages`);
        continue;
      }

      // Check for existing active jobs
      const existingJob = await db.collection('jobs').findOne({
        book_id: bookId,
        status: { $in: ['pending', 'processing'] },
      });

      if (existingJob) {
        results.skipped.push(`${bookTitle}: job already in progress`);
        continue;
      }

      // OCR: pages without OCR data
      if (type === 'ocr' || type === 'both') {
        const pagesNeedingOcr = pages.filter(p => {
          const ocrData = p.ocr?.data || '';
          return ocrData.length === 0;
        });

        if (pagesNeedingOcr.length > 0) {
          try {
            const jobId = nanoid(12);
            const job: Job = {
              id: jobId,
              type: 'batch_ocr',
              status: 'pending',
              progress: {
                total: pagesNeedingOcr.length,
                completed: 0,
                failed: 0,
              },
              book_id: bookId,
              book_title: bookTitle,
              created_at: new Date(),
              updated_at: new Date(),
              results: [],
              config: {
                model: 'gemini-2.5-flash',
                language: book.language || 'Latin',
                page_ids: pagesNeedingOcr.map(p => p.id),
                use_batch_api: true,
              },
            };

            await db.collection('jobs').insertOne(job as unknown as Record<string, unknown>);
            results.ocr_jobs.push({
              book_id: bookId,
              book_title: bookTitle,
              job_id: jobId,
              pages: pagesNeedingOcr.length,
            });
            processedCount++;
          } catch (e) {
            results.errors.push(`${bookTitle} OCR: ${e instanceof Error ? e.message : 'Unknown error'}`);
          }
        }
      }

      // Translation: pages with OCR but no translation
      if (type === 'translate' || type === 'both') {
        const pagesNeedingTranslation = pages.filter(p => {
          const ocrData = p.ocr?.data || '';
          const translationData = p.translation?.data || '';
          return ocrData.length > 0 && translationData.length === 0;
        });

        if (pagesNeedingTranslation.length > 0) {
          try {
            const jobId = nanoid(12);
            const job: Job = {
              id: jobId,
              type: 'batch_translate',
              status: 'pending',
              progress: {
                total: pagesNeedingTranslation.length,
                completed: 0,
                failed: 0,
              },
              book_id: bookId,
              book_title: bookTitle,
              created_at: new Date(),
              updated_at: new Date(),
              results: [],
              config: {
                model: 'gemini-2.5-flash',
                language: book.language || 'Latin',
                page_ids: pagesNeedingTranslation.map(p => p.id),
                use_batch_api: true,
              },
            };

            await db.collection('jobs').insertOne(job as unknown as Record<string, unknown>);
            results.translate_jobs.push({
              book_id: bookId,
              book_title: bookTitle,
              job_id: jobId,
              pages: pagesNeedingTranslation.length,
            });
            processedCount++;
          } catch (e) {
            results.errors.push(`${bookTitle} Translation: ${e instanceof Error ? e.message : 'Unknown error'}`);
          }
        }
      }
    }

    const duration = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      message: `Created ${results.ocr_jobs.length} OCR jobs and ${results.translate_jobs.length} translation jobs`,
      duration_ms: duration,
      ...results,
      next_step: 'Call POST /api/batch-jobs/process-pending to start processing these jobs',
    });

  } catch (error) {
    console.error('[process-all] Error:', error);
    return NextResponse.json({
      error: 'Failed to create batch jobs',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

/**
 * GET /api/batch-jobs/process-all
 *
 * Shows what work is pending across all books.
 */
export async function GET() {
  try {
    const db = await getDb();

    // Get aggregate stats
    const books = await db.collection('books').find().toArray();

    const stats = {
      total_books: books.length,
      books_needing_ocr: 0,
      books_needing_translation: 0,
      total_pages_needing_ocr: 0,
      total_pages_needing_translation: 0,
      active_jobs: 0,
      pending_batch_jobs: 0,
    };

    for (const book of books) {
      const bookId = book.id || book._id?.toString();
      const pages = await db.collection('pages')
        .find({ book_id: bookId })
        .toArray();

      const needsOcr = pages.filter(p => (p.ocr?.data || '').length === 0).length;
      const needsTranslation = pages.filter(p =>
        (p.ocr?.data || '').length > 0 && (p.translation?.data || '').length === 0
      ).length;

      if (needsOcr > 0) {
        stats.books_needing_ocr++;
        stats.total_pages_needing_ocr += needsOcr;
      }
      if (needsTranslation > 0) {
        stats.books_needing_translation++;
        stats.total_pages_needing_translation += needsTranslation;
      }
    }

    // Count active jobs
    const activeJobs = await db.collection('jobs')
      .countDocuments({ status: { $in: ['pending', 'processing'] } });
    stats.active_jobs = activeJobs;

    // Count pending batch jobs (created but not yet submitted to Gemini)
    const pendingBatch = await db.collection('jobs')
      .countDocuments({
        status: { $in: ['pending', 'processing'] },
        'config.use_batch_api': true,
        gemini_batch_job: { $exists: false },
      });
    stats.pending_batch_jobs = pendingBatch;

    return NextResponse.json({
      stats,
      estimate: {
        ocr_cost_batch_api: `~$${(stats.total_pages_needing_ocr * 0.0025).toFixed(2)}`,
        translation_cost_batch_api: `~$${(stats.total_pages_needing_translation * 0.0015).toFixed(2)}`,
        note: 'Batch API costs are 50% of realtime',
      },
      actions: {
        create_jobs: 'POST /api/batch-jobs/process-all?type=both&limit=10',
        process_pending: 'POST /api/batch-jobs/process-pending',
      },
    });

  } catch (error) {
    console.error('[process-all] Error:', error);
    return NextResponse.json({
      error: 'Failed to get stats',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
