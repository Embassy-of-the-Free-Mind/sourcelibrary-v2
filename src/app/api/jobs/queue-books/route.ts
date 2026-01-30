import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { enqueueBookOcr } from '@/lib/api-client/queues';
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

    // Auto-find books needing OCR if requested or if no bookIds provided
    if (auto || !bookIds || bookIds.length === 0) {
      console.log('[queue-books] Auto-finding books needing OCR...');
      const db = await getDb();

      // Find books that need OCR (no recent processing)
      const candidateBooks = await db.collection('books')
        .find({})
        .limit(500)
        .toArray();

      const booksNeedingOcr: string[] = [];

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

        // Check if book has OCR
        const ocrPageCount = await db.collection('pages').countDocuments({
          book_id: book.id,
          'ocr.data': { $exists: true, $ne: null }
        });

        if (ocrPageCount < pageCount) {
          // Check for existing active jobs
          const activeJob = await db.collection('jobs').findOne({
            book_id: book.id,
            type: 'batch_ocr',
            status: { $in: ['pending', 'processing'] }
          });

          if (!activeJob) {
            booksNeedingOcr.push(book.id);
            if (booksNeedingOcr.length >= effectiveLimit) break;
          }
        }
      }

      bookIds = booksNeedingOcr;
      console.log(`[queue-books] Found ${bookIds.length} books needing OCR`);
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
      const pages = await db.collection('pages')
        .find({
          book_id: bookId,
          $or: [
            { photo: { $exists: true, $ne: null } },
            { photo_original: { $exists: true, $ne: null } }
          ]
        })
        .sort({ page_number: 1 })
        .toArray();

      if (pages.length === 0) {
        console.warn(`[queue-books] Book ${bookId} has no pages, skipping`);
        continue;
      }

      const pageIds = pages.map(p => p.id);

      // Create job record
      const jobId = nanoid(12);
      await db.collection('jobs').insertOne({
        id: jobId,
        type: 'batch_ocr',
        book_id: bookId,
        book_title: book.title,
        status: 'pending',
        progress: {
          total: pages.length,
          completed: 0,
          failed: 0
        },
        config: {
          model: 'gemini-3-flash-preview',
          language: book.original_language || 'Latin',
          page_ids: pageIds,
          use_batch_api: true
        },
        initiated_by: 'queue_system',
        created_at: new Date(),
        updated_at: new Date()
      });

      console.log(`[queue-books] Created job ${jobId} for book ${bookId} (${pages.length} pages)`);

      // Enqueue to book-batch-ocr
      await enqueueBookOcr({
        bookId,
        dbJobId: jobId,
        pageIds,
        model: 'gemini-3-flash-preview',
        language: book.original_language || 'Latin'
      });

      console.log(`[queue-books] Enqueued book ${bookId} to book-batch-ocr`);

      jobIds.push(jobId);
      queuedBooks.push({
        bookId,
        jobId,
        pageCount: pages.length
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
