import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { nanoid } from 'nanoid';
import { DEFAULT_MODEL } from '@/lib/types/ai-models';
import type { JobStatus, JobType } from '@/lib/types/job';
import { enqueuePagesForJob } from '@/lib/queue-utils';

/**
 * POST /api/jobs/queue-books
 *
 * Queue specific pages from a book for processing.
 * Supports three actions: OCR, Translation, and Image Extraction.
 *
 * Body: {
 *   bookId: string,
 *   pageIds: string[],
 *   action: JobType,  // 'ocr' | 'translation' | 'image_extraction'
 *   customPrompt?: string  // Optional, for OCR and Translation only
 * }
 *
 * Flow:
 * 1. Validate inputs and check for active jobs
 * 2. Create ONE job record for all selected pages
 * 3. Enqueue pages directly to action-specific queue:
 *    - OCR: page-ocr-queue (standard, parallel processing)
 *    - Translation: page-translation-queue (FIFO, sequential processing)
 *    - Image Extraction: page-image-extraction-queue (standard, parallel)
 * 4. Workers process pages (1 Lambda per page) and update job progress
 *
 * Returns: { success: true, jobId: string, pageCount: number }
 */

export const maxDuration = 60; // 1 minute timeout

export async function POST(request: NextRequest) {
  try {
    const {
      bookId,
      pageIds,
      action,
      customPrompt
    }: {
      bookId: string;
      pageIds: string[];
      action: JobType;
      customPrompt?: string;
    } = await request.json();

    // Validate required fields
    if (!bookId || !pageIds || !action) {
      return NextResponse.json(
        { error: 'Missing required fields: bookId, pageIds, action' },
        { status: 400 }
      );
    }

    if (!Array.isArray(pageIds) || pageIds.length === 0) {
      return NextResponse.json(
        { error: 'No pages selected' },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Check book exists
    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json(
        { error: 'Book not found' },
        { status: 404 }
      );
    }

    // Check for active job (exclude terminal statuses: completed, failed, cancelled, partial)
    if (book.current_job_id) {
      const activeJob = await db.collection('jobs').findOne({
        id: book.current_job_id,
        status: { $nin: ['completed', 'failed', 'cancelled', 'partial'] as JobStatus[] }
      });
      if (activeJob) {
        return NextResponse.json(
          { error: 'Book already has an active job' },
          { status: 409 }
        );
      }
    }

    // Create ONE job record for all pages
    // All page workers will use this same jobId to track progress
    const jobId = nanoid(12);

    await db.collection('jobs').insertOne({
      id: jobId,
      type: action,  // JobType: 'ocr' | 'translation' | 'image_extraction'
      book_id: bookId,
      book_title: book.title,
      status: 'pending' as JobStatus,
      progress: {
        total: pageIds.length,
        completed: 0,  // Single counter for completed pages
        failed: 0
      },
      config: {
        page_ids: pageIds,
        custom_prompt: customPrompt,
        model: DEFAULT_MODEL,
        language: book.original_language || ''
      },
      initiated_by: 'user',
      created_at: new Date(),
      updated_at: new Date()
    });

    console.log(`[queue-books] Created ${action} job ${jobId} for book ${bookId} (${pageIds.length} pages)`);

    // Set current_job_id on book
    await db.collection('books').updateOne(
      { id: bookId },
      { $set: { current_job_id: jobId } }
    );

    // Enqueue pages to appropriate queue
    await enqueuePagesForJob(bookId, pageIds, action, jobId, customPrompt);

    console.log(`[queue-books] Enqueued ${pageIds.length} pages to ${action} queue for job ${jobId}`);

    return NextResponse.json({
      success: true,
      jobId,
      pageCount: pageIds.length,
      message: `Queued ${pageIds.length} pages for ${action}`
    });

  } catch (error) {
    console.error('[queue-books] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to queue job' },
      { status: 500 }
    );
  }
}
