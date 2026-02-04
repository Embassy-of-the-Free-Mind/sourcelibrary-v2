import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { sendMessage, QUEUE_URLS } from '@/lib/sqs-client';
import type { QueueBooksRequest, QueueBooksResponse } from '@/lib/api-client/types/queues';
import { nanoid } from 'nanoid';
import { DEFAULT_MODEL } from '@/lib/types/ai-models';

/**
 * POST /api/jobs/queue-books
 *
 * Queue multiple books for OCR and translation processing.
 * This is the entry point for the SQS-based pipeline.
 *
 * Flow:
 * 1. Creates job records for each book
 * 2. Sends messages to book-processing-queue (SQS FIFO)
 * 3. Lambda book processor enqueues pages to page-ocr-queue
 * 4. Lambda OCR processors handle pages (rolling window, max 10 concurrent)
 * 5. Last OCR page triggers translation phase
 * 6. Translation completes → job marked as done
 *
 * Queue Specific Books:
 * Body: { bookIds: string[] } (recommended <20 books)
 *
 * Auto-Select and Queue Books:
 * Body: {"auto": true, "limit": 10}
 *
 * Returns: { success: true, jobIds: string[], queuedBooks: [...] }
 */

export const maxDuration = 60; // 1 minute timeout

const MAX_BOOKS_PER_REQUEST = 20; // Recommended limit (no hard limit, but keeps API responsive)

export async function POST(request: NextRequest) {
  try {
    const body: QueueBooksRequest = await request.json();
    let { bookIds } = body;
    const { auto = false, limit = 10 } = body;

    // Enforce safety limit
    const effectiveLimit = Math.min(limit, MAX_BOOKS_PER_REQUEST);

    // Auto-find books needing processing if requested or if no bookIds provided
    if (auto || !bookIds || bookIds.length === 0) {
      console.log('[queue-books] Auto-finding books needing processing...');
      const db = await getDb();

      // Find books that need OCR or translation
      const candidateBooks = await db.collection('books')
        .find({})
        .limit(500)
        .toArray();

      const booksNeedingProcessing: string[] = [];

      for (const book of candidateBooks) {
        // Check if book has pages
        const pageCount = await db.collection('pages').countDocuments({
          book_id: book.id,
          $or: [
            { photo: { $exists: true, $ne: null } },
            { photo_original: { $exists: true, $ne: null } }
          ]
        });

        if (pageCount === 0) continue;

        // Check if book has incomplete OCR
        const ocrPageCount = await db.collection('pages').countDocuments({
          book_id: book.id,
          'ocr.data': { $exists: true, $nin: ['', null] }
        });

        const needsOcr = ocrPageCount < pageCount;

        // Check if book has incomplete translation (only if OCR is complete)
        let needsTranslation = false;
        if (!needsOcr && ocrPageCount > 0) {
          const translationPageCount = await db.collection('pages').countDocuments({
            book_id: book.id,
            'translation.data': { $exists: true, $nin: ['', null] }
          });
          needsTranslation = translationPageCount < ocrPageCount;
        }

        if (needsOcr || needsTranslation) {
          // Check if book already has an active job
          if (book.current_job_id) {
            const activeJob = await db.collection('jobs').findOne({
              id: book.current_job_id,
              status: { $in: ['pending', 'ocr', 'translation'] }
            });
            if (activeJob) {
              continue; // Skip books with active jobs
            }
          }

          booksNeedingProcessing.push(book.id);
          if (booksNeedingProcessing.length >= effectiveLimit) break;
        }
      }

      bookIds = booksNeedingProcessing;
      console.log(`[queue-books] Found ${bookIds.length} books needing processing`);
    }

    // Validate input
    if (!bookIds || !Array.isArray(bookIds) || bookIds.length === 0) {
      return NextResponse.json(
        { error: 'No books to queue (provide bookIds or use auto: true)' },
        { status: 400 }
      );
    }

    // Enforce max limit by slicing
    if (bookIds.length > MAX_BOOKS_PER_REQUEST) {
      console.log(`[queue-books] Limiting from ${bookIds.length} to ${MAX_BOOKS_PER_REQUEST} books`);
      bookIds = bookIds.slice(0, MAX_BOOKS_PER_REQUEST);
    }

    const db = await getDb();
    const jobIds: string[] = [];
    const queuedBooks: Array<{ bookId: string; jobId: string; pageCount: number }> = [];

    console.log(`[queue-books] Queueing ${bookIds.length} books`);

    // Process each book
    for (const bookId of bookIds) {
      // Verify book exists
      const book = await db.collection('books').findOne({ id: bookId });
      if (!book) {
        console.warn(`[queue-books] Book ${bookId} not found, skipping`);
        continue;
      }

      // Get all pages for this book
      const allPages = await db.collection('pages')
        .find({
          book_id: bookId,
          $or: [
            { photo: { $exists: true, $ne: null } },
            { photo_original: { $exists: true, $ne: null } }
          ]
        })
        .sort({ page_number: 1 })
        .toArray();

      if (allPages.length === 0) {
        console.warn(`[queue-books] Book ${bookId} has no pages, skipping`);
        continue;
      }

      // Determine what this book needs: OCR or Translation
      const pagesNeedingOcr = allPages.filter(p => !p.ocr?.data || p.ocr.data === '');
      const pagesWithOcr = allPages.filter(p => p.ocr?.data && p.ocr.data !== '');
      const pagesNeedingTranslation = pagesWithOcr.filter(p => !p.translation?.data || p.translation.data === '');

      let jobType: 'batch_ocr' | 'batch_translation';
      let targetPages: typeof allPages;
      let queueAction: 'ocr' | 'translation';

      if (pagesNeedingOcr.length > 0) {
        // Book needs OCR - queue only pages without OCR
        jobType = 'batch_ocr';
        targetPages = pagesNeedingOcr;
        queueAction = 'ocr';
        console.log(`[queue-books] Book ${bookId}: ${pagesNeedingOcr.length}/${allPages.length} pages need OCR`);
      } else if (pagesNeedingTranslation.length > 0) {
        // All pages have OCR, but some need translation
        jobType = 'batch_translation';
        targetPages = pagesNeedingTranslation;
        queueAction = 'translation';
        console.log(`[queue-books] Book ${bookId}: ${pagesNeedingTranslation.length}/${pagesWithOcr.length} pages need translation`);
      } else {
        // Book is fully processed
        console.log(`[queue-books] Book ${bookId}: already fully processed, skipping`);
        continue;
      }

      // Create job record with simplified schema
      const jobId = nanoid(12);
      const model = DEFAULT_MODEL;
      const sourceLanguage = book.original_language || 'Latin';

      await db.collection('jobs').insertOne({
        id: jobId,
        type: jobType,
        book_id: bookId,
        book_title: book.title,
        status: 'pending',
        progress: {
          total: targetPages.length,
          ocr_completed: 0,
          translation_completed: 0
        },
        config: {
          model,
          language: sourceLanguage
        },
        initiated_by: 'queue_system',
        created_at: new Date(),
        updated_at: new Date()
      });

      console.log(`[queue-books] Created ${jobType} job ${jobId} for book ${bookId} (${targetPages.length} pages)`);

      // Enqueue to SQS book processing queue (skip in local test mode)
      const localTestMode = process.env.LOCAL_TEST_MODE === 'true';

      if (!localTestMode) {
        await sendMessage({
          queueUrl: QUEUE_URLS.bookProcessing,
          message: {
            bookId,
            dbJobId: jobId,
            phase: queueAction
          },
          messageGroupId: bookId
        });
        console.log(`[queue-books] Enqueued book ${bookId} to SQS (${queueAction} phase)`);
      } else {
        console.log(`[queue-books] LOCAL_TEST_MODE: Skipped SQS send for book ${bookId}. Use test endpoints to process.`);
      }

      // Set current_job_id on book
      await db.collection('books').updateOne(
        { id: bookId },
        { $set: { current_job_id: jobId } }
      );

      jobIds.push(jobId);
      queuedBooks.push({
        bookId,
        jobId,
        pageCount: targetPages.length
      });
    }

    if (jobIds.length === 0) {
      return NextResponse.json(
        { error: 'No valid books to queue' },
        { status: 400 }
      );
    }

    console.log(`[queue-books] Successfully queued ${jobIds.length}/${bookIds.length} books`);

    const response: QueueBooksResponse = {
      success: true,
      jobIds
    };

    return NextResponse.json({
      ...response,
      message: `Queued ${jobIds.length} books for processing`,
      queuedBooks
    });

  } catch (error) {
    console.error('[queue-books] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to queue books' },
      { status: 500 }
    );
  }
}
