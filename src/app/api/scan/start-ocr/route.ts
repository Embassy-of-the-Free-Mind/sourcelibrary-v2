export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { nanoid } from 'nanoid';
import { DEFAULT_MODEL } from '@/lib/types/ai-models';
import type { JobStatus } from '@/lib/types/job';
import { enqueuePagesForJob } from '@/lib/queue-utils';

/**
 * POST /api/scan/start-ocr
 *
 * Queue OCR for a Mobile Scan book. Unauthenticated — access controlled
 * by checking the book was created via Mobile Scan.
 *
 * Body: { bookId: string }
 */
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const { bookId } = await request.json();

    if (!bookId) {
      return NextResponse.json({ error: 'Book ID required' }, { status: 400 });
    }

    const db = await getDb();

    // Validate: must be a Mobile Scan book
    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    if (
      book.image_source?.provider !== 'user_upload' ||
      book.image_source?.provider_name !== 'Mobile Scan'
    ) {
      return NextResponse.json(
        { error: 'Only Mobile Scan books can use this endpoint' },
        { status: 403 }
      );
    }

    // Check for active job
    if (book.job) {
      const activeJob = await db.collection('jobs').findOne({
        id: book.job.job_id,
        status: { $nin: ['completed', 'failed', 'cancelled', 'partial'] as JobStatus[] },
      });
      if (activeJob) {
        return NextResponse.json(
          { error: 'Book already has an active job', jobId: activeJob.id },
          { status: 409 }
        );
      }
    }

    // Get all page IDs
    const pages = await db.collection('pages')
      .find({ book_id: bookId })
      .project({ id: 1 })
      .toArray();

    if (pages.length === 0) {
      return NextResponse.json({ error: 'No pages to process' }, { status: 400 });
    }

    const pageIds = pages.map(p => p.id);
    const jobId = nanoid(12);

    // Create job record
    await db.collection('jobs').insertOne({
      id: jobId,
      type: 'ocr',
      book_id: bookId,
      book_title: book.title,
      status: 'pending' as JobStatus,
      progress: {
        total: pageIds.length,
        completed: 0,
        failed: 0,
      },
      config: {
        page_ids: pageIds,
        model: DEFAULT_MODEL,
        language: book.language || 'auto-detect',
      },
      initiated_by: 'scan_ui',
      created_at: new Date(),
      updated_at: new Date(),
    });

    // Set active job on book
    await db.collection('books').updateOne(
      { id: bookId },
      { $set: { job: { type: 'realtime', job_id: jobId } } }
    );

    // Enqueue pages to OCR queue
    await enqueuePagesForJob(bookId, pageIds, 'ocr', jobId);

    // Enroll in pipeline if not already
    if (!book.pipeline_auto) {
      await db.collection('books').updateOne(
        { id: bookId },
        {
          $set: {
            pipeline_auto: {
              status: 'ocr_submitted',
              source: 'scan_ui',
              queued_at: new Date(),
              started_at: new Date(),
              last_updated: new Date(),
            },
          },
        }
      );
    }

    console.log(`[scan/start-ocr] Created OCR job ${jobId} for book ${bookId} (${pageIds.length} pages)`);

    return NextResponse.json({
      success: true,
      jobId,
      pageCount: pageIds.length,
    });
  } catch (error) {
    console.error('Start OCR error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start OCR' },
      { status: 500 }
    );
  }
}
