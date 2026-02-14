import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { PROMPT_VERSION } from '@/lib/types/prompts/defaults';
import { POST as batchOcrPost } from '@/app/api/books/[id]/batch-ocr-async/route';
import { POST as batchTranslatePost } from '@/app/api/books/[id]/batch-translate-async/route';

export const maxDuration = 300;

/**
 * POST /api/admin/campaign
 *
 * Multi-book batch processing orchestrator.
 *
 * Body:
 *   type: 'ocr' | 'translation'
 *   mode: 'new' | 'reprocess'
 *   maxBooks: number (default 10)
 *   pagesPerBook: number (default 10 for OCR, 500 for translation)
 *   model: string (default 'gemini-3-flash-preview')
 *   dryRun: boolean (default false)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      type = 'ocr',
      mode = 'new',
      maxBooks = 10,
      pagesPerBook,
      model = 'gemini-3-flash-preview',
      dryRun = false,
    } = body;

    const limit = pagesPerBook ?? (type === 'ocr' ? 10 : 500);

    if (!['ocr', 'translation'].includes(type)) {
      return NextResponse.json({ error: 'type must be "ocr" or "translation"' }, { status: 400 });
    }
    if (!['new', 'reprocess'].includes(mode)) {
      return NextResponse.json({ error: 'mode must be "new" or "reprocess"' }, { status: 400 });
    }

    const db = await getDb();

    // Check how many Gemini batch jobs are already running
    const activeJobs = await db.collection('batch_jobs').countDocuments({
      status: { $in: ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] },
    });

    // Find eligible books
    const books = await findEligibleBooks(db, type, mode, maxBooks);

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        type,
        mode,
        activeJobs,
        eligibleBooks: books.length,
        pagesPerBook: limit,
        model,
        books: books.map(b => ({
          id: b.id,
          title: b.title,
          eligiblePages: b.eligiblePages,
        })),
      });
    }

    // Submit batch jobs for each book
    const submitted = [];
    const errors = [];

    for (const book of books) {
      try {
        // Skip books with active jobs
        const existingJob = await db.collection('batch_jobs').findOne({
          book_id: book.id,
          status: { $in: ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] },
        });
        if (existingJob) {
          errors.push(`${book.title}: already has active job ${existingJob.job_name}`);
          continue;
        }

        const force = mode === 'reprocess';
        let result;

        if (type === 'ocr') {
          const fakeRequest = new NextRequest('http://localhost/api/books/' + book.id + '/batch-ocr-async', {
            method: 'POST',
            body: JSON.stringify({ limit, model, force }),
            headers: { 'Content-Type': 'application/json' },
          });
          result = await batchOcrPost(fakeRequest, { params: Promise.resolve({ id: book.id }) });
        } else {
          const fakeRequest = new NextRequest('http://localhost/api/books/' + book.id + '/batch-translate-async', {
            method: 'POST',
            body: JSON.stringify({ limit, model, force, targetLanguage: 'English' }),
            headers: { 'Content-Type': 'application/json' },
          });
          result = await batchTranslatePost(fakeRequest, { params: Promise.resolve({ id: book.id }) });
        }

        const data = await result.json();

        if (data.success) {
          submitted.push({
            bookId: book.id,
            title: book.title,
            jobName: data.jobName,
            pagesSubmitted: data.pagesSubmitted,
          });
        } else {
          errors.push(`${book.title}: ${data.error || data.message || 'Unknown error'}`);
        }
      } catch (e) {
        errors.push(`${book.title}: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    }

    // Estimate cost (Gemini Batch API is 50% of standard pricing)
    // Flash: ~$0.10/1M input, ~$0.40/1M output at standard; batch is half
    const totalPages = submitted.reduce((sum, s) => sum + s.pagesSubmitted, 0);
    const estimatedCost = type === 'ocr'
      ? totalPages * 0.0003  // ~$0.0003/page for OCR (image + text)
      : totalPages * 0.0001; // ~$0.0001/page for translation (text only)

    return NextResponse.json({
      success: true,
      type,
      mode,
      activeJobsBefore: activeJobs,
      booksSubmitted: submitted.length,
      totalPages,
      estimatedCost: `$${estimatedCost.toFixed(2)}`,
      submitted,
      errors: errors.length > 0 ? errors : undefined,
    });

  } catch (error) {
    console.error('[campaign] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Campaign failed' },
      { status: 500 }
    );
  }
}

/**
 * Find books eligible for processing based on type and mode.
 */
async function findEligibleBooks(
  db: Awaited<ReturnType<typeof getDb>>,
  type: string,
  mode: string,
  maxBooks: number
): Promise<Array<{ id: string; title: string; eligiblePages: number }>> {

  if (type === 'ocr' && mode === 'new') {
    // Books with pages that have images but no OCR
    return db.collection('books').aggregate([
      {
        $lookup: {
          from: 'pages',
          let: { bookId: '$id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$book_id', '$$bookId'] },
                $and: [
                  {
                    $or: [
                      { photo: { $exists: true, $ne: null } },
                      { photo_original: { $exists: true, $ne: null } },
                    ],
                  },
                  {
                    $or: [
                      { 'ocr.data': { $exists: false } },
                      { 'ocr.data': null },
                      { 'ocr.data': '' },
                    ],
                  },
                ],
              },
            },
            { $count: 'count' },
          ],
          as: 'missing_ocr',
        },
      },
      {
        $addFields: {
          eligiblePages: { $ifNull: [{ $arrayElemAt: ['$missing_ocr.count', 0] }, 0] },
        },
      },
      { $match: { eligiblePages: { $gt: 0 } } },
      { $sort: { eligiblePages: -1 } },
      { $limit: maxBooks },
      { $project: { _id: 0, id: 1, title: 1, eligiblePages: 1 } },
    ]).toArray() as Promise<Array<{ id: string; title: string; eligiblePages: number }>>;
  }

  if (type === 'ocr' && mode === 'reprocess') {
    // Books with pages OCR'd using old prompt version (not current PROMPT_VERSION)
    // Since most pages don't have prompt_version stored, we look for pages with OCR
    // that lack the current version marker
    return db.collection('books').aggregate([
      {
        $lookup: {
          from: 'pages',
          let: { bookId: '$id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$book_id', '$$bookId'] },
                'ocr.data': { $exists: true, $nin: [null, ''] },
                'ocr.prompt_version': { $ne: PROMPT_VERSION },
              },
            },
            { $count: 'count' },
          ],
          as: 'old_ocr',
        },
      },
      {
        $addFields: {
          eligiblePages: { $ifNull: [{ $arrayElemAt: ['$old_ocr.count', 0] }, 0] },
        },
      },
      { $match: { eligiblePages: { $gt: 0 } } },
      // Prioritize partially-done books (fewer pages = closer to done)
      { $sort: { eligiblePages: 1 } },
      { $limit: maxBooks },
      { $project: { _id: 0, id: 1, title: 1, eligiblePages: 1 } },
    ]).toArray() as Promise<Array<{ id: string; title: string; eligiblePages: number }>>;
  }

  if (type === 'translation' && mode === 'new') {
    // Books with OCR'd pages that have no translation
    return db.collection('books').aggregate([
      {
        $lookup: {
          from: 'pages',
          let: { bookId: '$id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$book_id', '$$bookId'] },
                'ocr.data': { $exists: true, $nin: [null, ''] },
                $or: [
                  { 'translation.data': { $exists: false } },
                  { 'translation.data': null },
                  { 'translation.data': '' },
                ],
              },
            },
            { $count: 'count' },
          ],
          as: 'missing_translation',
        },
      },
      {
        $addFields: {
          eligiblePages: { $ifNull: [{ $arrayElemAt: ['$missing_translation.count', 0] }, 0] },
        },
      },
      { $match: { eligiblePages: { $gt: 0 } } },
      { $sort: { eligiblePages: -1 } },
      { $limit: maxBooks },
      { $project: { _id: 0, id: 1, title: 1, eligiblePages: 1 } },
    ]).toArray() as Promise<Array<{ id: string; title: string; eligiblePages: number }>>;
  }

  if (type === 'translation' && mode === 'reprocess') {
    // Books with pages translated via batch_api (the broken prompt)
    // These were all done with the old simple prompt before the XML tag fix
    return db.collection('books').aggregate([
      {
        $lookup: {
          from: 'pages',
          let: { bookId: '$id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$book_id', '$$bookId'] },
                'translation.data': { $exists: true, $nin: [null, ''] },
                'translation.source': 'batch_api',
                'translation.prompt_version': { $ne: PROMPT_VERSION },
              },
            },
            { $count: 'count' },
          ],
          as: 'old_translation',
        },
      },
      {
        $addFields: {
          eligiblePages: { $ifNull: [{ $arrayElemAt: ['$old_translation.count', 0] }, 0] },
        },
      },
      { $match: { eligiblePages: { $gt: 0 } } },
      { $sort: { eligiblePages: 1 } },
      { $limit: maxBooks },
      { $project: { _id: 0, id: 1, title: 1, eligiblePages: 1 } },
    ]).toArray() as Promise<Array<{ id: string; title: string; eligiblePages: number }>>;
  }

  return [];
}

/**
 * GET /api/admin/campaign - Show campaign status
 */
export async function GET() {
  try {
    const db = await getDb();

    // Active batch jobs
    const activeJobs = await db.collection('batch_jobs')
      .find({ status: { $in: ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] } })
      .sort({ created_at: -1 })
      .limit(50)
      .toArray();

    // Recent completed jobs
    const recentJobs = await db.collection('batch_jobs')
      .find({ status: { $in: ['saved', 'JOB_STATE_SUCCEEDED'] } })
      .sort({ completed_at: -1 })
      .limit(20)
      .toArray();

    // Overall stats
    const [ocrStats] = await db.collection('pages').aggregate([
      {
        $facet: {
          total: [{ $count: 'count' }],
          withOcr: [
            { $match: { 'ocr.data': { $exists: true, $nin: [null, ''] } } },
            { $count: 'count' },
          ],
          withTranslation: [
            { $match: { 'translation.data': { $exists: true, $nin: [null, ''] } } },
            { $count: 'count' },
          ],
          withCurrentOcrPrompt: [
            { $match: { 'ocr.prompt_version': PROMPT_VERSION } },
            { $count: 'count' },
          ],
          withCurrentTranslationPrompt: [
            { $match: { 'translation.prompt_version': PROMPT_VERSION } },
            { $count: 'count' },
          ],
        },
      },
    ]).toArray();

    const total = ocrStats?.total?.[0]?.count || 0;
    const withOcr = ocrStats?.withOcr?.[0]?.count || 0;
    const withTranslation = ocrStats?.withTranslation?.[0]?.count || 0;
    const withCurrentOcr = ocrStats?.withCurrentOcrPrompt?.[0]?.count || 0;
    const withCurrentTranslation = ocrStats?.withCurrentTranslationPrompt?.[0]?.count || 0;

    return NextResponse.json({
      promptVersion: PROMPT_VERSION,
      pages: {
        total,
        withOcr,
        withoutOcr: total - withOcr,
        withTranslation,
        withoutTranslation: withOcr - withTranslation,
        withCurrentOcrPrompt: withCurrentOcr,
        needsOcrReprocess: withOcr - withCurrentOcr,
        withCurrentTranslationPrompt: withCurrentTranslation,
        needsTranslationReprocess: withTranslation - withCurrentTranslation,
      },
      activeJobs: activeJobs.map(j => ({
        jobName: j.job_name,
        bookId: j.book_id,
        type: j.type,
        pageCount: j.page_count,
        force: j.force || false,
        status: j.status,
        createdAt: j.created_at,
      })),
      recentCompleted: recentJobs.map(j => ({
        jobName: j.job_name,
        bookId: j.book_id,
        type: j.type,
        successCount: j.success_count || j.completed_pages || 0,
        failCount: j.fail_count || j.failed_pages || 0,
        completedAt: j.completed_at,
      })),
    });

  } catch (error) {
    console.error('[campaign] Status error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get status' },
      { status: 500 }
    );
  }
}
