import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { enqueueBookOcr, enqueueBookTranslation } from '@/lib/api-client/queues.server';
import type { QueueBooksRequest, QueueBooksResponse } from '@/lib/api-client/types/queues';
import { nanoid } from 'nanoid';

/**
 * POST /api/jobs/queue-books
 *
 * Queue multiple books for OCR and translation processing.
 * This is the entry point for the Vercel Queue-based pipeline.
 *
 * Flow:
 * 1. Creates job records for each book
 * 2. Enqueues books to book-batch-ocr queue
 * 3. OCR completes → batch-monitor triggers book-batch-translation
 * 4. Translation completes → job marked as done
 *
 * Queue Specific Books:
 * Body: { bookIds: string[] } (max 10 books internal limit)
 * 
 * Auto-Select and Queue Books:
 * Body: {"auto": true, "limit": 5}
 * 
 * Returns: { success: true, jobIds: string[] }
 */

export const maxDuration = 60; // 1 minute timeout

const MAX_BOOKS_PER_REQUEST = 10; // Safety limit to prevent overload

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
          // Check for existing active jobs
          const activeJob = await db.collection('jobs').findOne({
            book_id: book.id,
            status: { $in: ['pending', 'processing'] }
          });

          if (!activeJob) {
            booksNeedingProcessing.push(book.id);
            if (booksNeedingProcessing.length >= effectiveLimit) break;
          }
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

      const pageIds = targetPages.map(p => p.id);

      // Create job record
      const jobId = nanoid(12);
      const model = 'gemini-3-flash-preview';
      const sourceLanguage = book.original_language || 'Latin';
      const targetLanguage = 'English';

      await db.collection('jobs').insertOne({
        id: jobId,
        type: jobType,
        book_id: bookId,
        book_title: book.title,
        status: 'pending',
        progress: {
          total: targetPages.length,
          completed: 0,
          failed: 0
        },
        config: {
          model,
          language: sourceLanguage,
          page_ids: pageIds,
          ...(jobType === 'batch_ocr' ? { use_batch_api: true } : {
            source_language: sourceLanguage,
            target_language: targetLanguage
          })
        },
        initiated_by: 'queue_system',
        created_at: new Date(),
        updated_at: new Date()
      });

      console.log(`[queue-books] Created ${jobType} job ${jobId} for book ${bookId} (${targetPages.length} pages)`);

      // Enqueue to appropriate queue
      if (queueAction === 'ocr') {
        await enqueueBookOcr({
          bookId,
          dbJobId: jobId,
          pageIds,
          model,
          language: sourceLanguage
        });
        console.log(`[queue-books] Enqueued book ${bookId} to book-batch-ocr`);
      } else {
        await enqueueBookTranslation({
          bookId,
          dbJobId: jobId,
          pageIds,
          model,
          sourceLanguage,
          targetLanguage,
          startPageIndex: 0
        });
        console.log(`[queue-books] Enqueued book ${bookId} to book-batch-translation`);
      }

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
