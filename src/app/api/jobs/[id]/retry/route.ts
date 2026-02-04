import { NextResponse } from 'next/server';
import { getJobById } from '@/lib/job-helpers';
import { sendMessage, QUEUE_URLS } from '@/lib/sqs-client';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { job, db } = await getJobById(id);

    // Only retry jobs with partial completion and failed pages
    if (job.status !== 'partial' && job.status !== 'failed') {
      return NextResponse.json(
        { error: 'Can only retry partial or failed jobs' },
        { status: 400 }
      );
    }

    if (!job.failed_page_ids || job.failed_page_ids.length === 0) {
      return NextResponse.json(
        { error: 'No failed pages to retry' },
        { status: 400 }
      );
    }

    // Auto-detect what phase needs retry based on progress
    const needsOcrRetry = job.progress.ocr_completed < job.progress.total;
    const needsTranslationRetry =
      job.progress.ocr_completed === job.progress.total &&
      job.progress.translation_completed < job.progress.ocr_completed;

    if (!needsOcrRetry && !needsTranslationRetry) {
      return NextResponse.json(
        { error: 'Job is already complete' },
        { status: 400 }
      );
    }

    const failedPageCount = job.failed_page_ids.length;

    if (needsOcrRetry) {
      // Retry OCR: Re-enqueue book to book-processing-queue for OCR phase with retry pages
      console.log(`[retry-job] Retrying ${failedPageCount} failed OCR pages for job ${id}`);

      // Update job status back to OCR phase and clear failed_page_ids
      await db.collection('jobs').updateOne(
        { id },
        {
          $set: {
            status: 'ocr',
            updated_at: new Date()
          },
          $unset: { failed_page_ids: '' }
        }
      );

      // Re-enqueue book to book-processing-queue for OCR phase
      await sendMessage({
        queueUrl: QUEUE_URLS.bookProcessing,
        message: {
          bookId: job.book_id,
          dbJobId: id,
          phase: 'ocr',
          retryPageIds: job.failed_page_ids
        },
        messageGroupId: job.book_id
      });

      return NextResponse.json({
        success: true,
        message: `Requeued ${failedPageCount} pages for OCR retry`,
        phase: 'ocr'
      });

    } else if (needsTranslationRetry) {
      // Retry Translation: Re-enqueue book to book-processing-queue for translation phase
      console.log(`[retry-job] Retrying ${failedPageCount} failed translation pages for job ${id}`);

      // Update job status back to translation phase and clear failed_page_ids
      await db.collection('jobs').updateOne(
        { id },
        {
          $set: {
            status: 'translation',
            updated_at: new Date()
          },
          $unset: { failed_page_ids: '' }
        }
      );

      // Re-enqueue book to book-processing-queue for translation phase
      await sendMessage({
        queueUrl: QUEUE_URLS.bookProcessing,
        message: {
          bookId: job.book_id,
          dbJobId: id,
          phase: 'translation',
          retryPageIds: job.failed_page_ids
        },
        messageGroupId: job.book_id
      });

      return NextResponse.json({
        success: true,
        message: `Requeued ${failedPageCount} pages for translation retry`,
        phase: 'translation'
      });
    }

  } catch (error: any) {
    console.error('Error retrying job:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to retry job' },
      { status: error.statusCode || 500 }
    );
  }
}
