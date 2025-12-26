import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { nanoid } from 'nanoid';
import type { Job } from '@/lib/types';

/**
 * Streaming Pipeline - processes each page fully (crop → OCR → translate)
 * before moving to the next, with parallelism across pages.
 *
 * This is more efficient than batch processing because:
 * 1. OCR starts as soon as each image is cropped (not after ALL are cropped)
 * 2. Translation starts as soon as each OCR completes
 * 3. Progress is visible per-page
 */

// GET: Check status of streaming pipeline job
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const db = await getDb();

    // Find active streaming pipeline job for this book
    const job = await db.collection('jobs').findOne({
      book_id: bookId,
      type: 'pipeline_stream',
      status: { $in: ['pending', 'processing'] }
    });

    if (!job) {
      // Get book info for starting a new pipeline
      const book = await db.collection('books').findOne({ id: bookId });
      if (!book) {
        return NextResponse.json({ error: 'Book not found' }, { status: 404 });
      }

      // Count pages needing work
      const pages = await db.collection('pages')
        .find({ book_id: bookId })
        .project({ id: 1, crop: 1, cropped_photo: 1, ocr: 1, translation: 1 })
        .toArray();

      const stats = {
        total: pages.length,
        needsCrop: pages.filter(p => p.crop && !p.cropped_photo).length,
        needsOcr: pages.filter(p => !p.ocr?.data).length,
        needsTranslation: pages.filter(p => p.ocr?.data && !p.translation?.data).length,
      };

      return NextResponse.json({
        active: false,
        bookId,
        bookTitle: book.display_title || book.title,
        stats,
      });
    }

    return NextResponse.json({
      active: true,
      job: {
        id: job.id,
        status: job.status,
        progress: job.progress,
        results: job.results,
        created_at: job.created_at,
        updated_at: job.updated_at,
      },
    });
  } catch (error) {
    console.error('Error fetching streaming pipeline:', error);
    return NextResponse.json({ error: 'Failed to fetch pipeline' }, { status: 500 });
  }
}

// POST: Start a new streaming pipeline
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const db = await getDb();
    const body = await request.json().catch(() => ({}));

    const { model = 'gemini-2.5-flash', language = 'Latin', parallelPages = 3 } = body;

    // Check for existing active job
    const existingJob = await db.collection('jobs').findOne({
      book_id: bookId,
      type: 'pipeline_stream',
      status: { $in: ['pending', 'processing'] }
    });

    if (existingJob) {
      return NextResponse.json({
        error: 'Streaming pipeline already running',
        jobId: existingJob.id
      }, { status: 400 });
    }

    // Get book and pages
    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const pages = await db.collection('pages')
      .find({ book_id: bookId })
      .sort({ page_number: 1 })
      .project({ id: 1, page_number: 1, crop: 1, cropped_photo: 1, ocr: 1, translation: 1 })
      .toArray();

    // Find pages that need any work
    const pagesToProcess = pages.filter(p =>
      (p.crop && !p.cropped_photo) ||  // needs crop
      !p.ocr?.data ||                   // needs OCR
      !p.translation?.data              // needs translation
    );

    if (pagesToProcess.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'All pages already processed',
        pagesProcessed: 0,
      });
    }

    // Create the job
    const jobId = nanoid(12);
    const job: Job = {
      id: jobId,
      type: 'pipeline_stream' as Job['type'],
      status: 'pending',
      progress: {
        total: pagesToProcess.length,
        completed: 0,
        failed: 0,
      },
      book_id: bookId,
      book_title: book.display_title || book.title,
      initiated_by: 'user',
      created_at: new Date(),
      updated_at: new Date(),
      results: [],
      config: {
        model,
        language,
        parallelPages,
        page_ids: pagesToProcess.map(p => p.id),
      },
    };

    await db.collection('jobs').insertOne(job as unknown as Record<string, unknown>);

    // Kick off processing
    const baseUrl = process.env.NEXT_PUBLIC_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

    fetch(`${baseUrl}/api/books/${bookId}/pipeline-stream/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId }),
    }).catch(() => {
      // Fire and forget - job will be picked up
    });

    return NextResponse.json({
      success: true,
      jobId,
      pagesQueued: pagesToProcess.length,
      message: `Started streaming pipeline for ${pagesToProcess.length} pages`,
    });
  } catch (error) {
    console.error('Error starting streaming pipeline:', error);
    return NextResponse.json({ error: 'Failed to start pipeline' }, { status: 500 });
  }
}

// DELETE: Cancel streaming pipeline
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;
    const db = await getDb();

    const result = await db.collection('jobs').updateOne(
      {
        book_id: bookId,
        type: 'pipeline_stream',
        status: { $in: ['pending', 'processing'] }
      },
      {
        $set: {
          status: 'cancelled',
          updated_at: new Date(),
          completed_at: new Date(),
        }
      }
    );

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: 'No active pipeline to cancel' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: 'Pipeline cancelled' });
  } catch (error) {
    console.error('Error cancelling pipeline:', error);
    return NextResponse.json({ error: 'Failed to cancel pipeline' }, { status: 500 });
  }
}
