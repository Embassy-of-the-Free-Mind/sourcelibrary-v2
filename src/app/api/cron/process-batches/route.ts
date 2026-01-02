import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { getBatchJobStatus, getBatchJobResults } from '@/lib/gemini-batch';

export const maxDuration = 300;

/**
 * GET /api/cron/process-batches
 *
 * Automated batch processing cron job. Does three things:
 * 1. Collects results from completed Gemini batch jobs
 * 2. Submits pending jobs to Gemini
 * 3. Queues new OCR/translation work if capacity available
 *
 * Can be triggered by:
 * - Vercel Cron (every 2 hours)
 * - Manual call for testing
 *
 * Query params:
 * - skip_queue: Don't queue new work, just process existing
 * - max_new_jobs: Max new jobs to create (default: 5)
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const { searchParams } = new URL(request.url);
  const skipQueue = searchParams.get('skip_queue') === 'true';
  const maxNewJobs = parseInt(searchParams.get('max_new_jobs') || '5', 10);

  // Verify cron secret in production (optional security)
  const cronSecret = request.headers.get('x-cron-secret');
  const expectedSecret = process.env.CRON_SECRET;
  if (expectedSecret && cronSecret !== expectedSecret) {
    // Allow without secret for manual testing, but log it
    console.log('[cron] Running without cron secret verification');
  }

  const results = {
    collected: [] as Array<{ job_id: string; book_title: string; pages_saved: number; pages_failed: number }>,
    submitted: [] as Array<{ job_id: string; book_title: string; pages: number }>,
    queued: [] as Array<{ book_id: string; book_title: string; type: string; pages: number }>,
    errors: [] as string[],
    stats: {
      jobs_checked: 0,
      jobs_completed: 0,
      jobs_still_running: 0,
      pages_saved: 0,
      new_jobs_created: 0,
    },
  };

  try {
    const db = await getDb();

    // ============================================
    // PHASE 1: Collect results from completed jobs
    // ============================================
    console.log('[cron] Phase 1: Checking for completed batch jobs...');

    const pendingJobs = await db.collection('batch_jobs')
      .find({
        status: { $in: ['pending', 'processing'] },
        gemini_job_name: { $exists: true },
      })
      .toArray();

    results.stats.jobs_checked = pendingJobs.length;

    for (const job of pendingJobs) {
      try {
        const geminiStatus = await getBatchJobStatus(job.gemini_job_name);

        if ((geminiStatus.state as string) === 'JOB_STATE_SUCCEEDED' || (geminiStatus.state as string) === 'BATCH_STATE_SUCCEEDED') {
          // Job complete - collect results
          console.log(`[cron] Collecting results for ${job.id} (${job.book_title})`);

          const batchResults = await getBatchJobResults(job.gemini_job_name);
          let successCount = 0;
          let failCount = 0;
          const now = new Date();

          for (const result of batchResults) {
            const pageId = result.key;

            if (result.error || !result.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
              failCount++;
              continue;
            }

            const text = result.response.candidates[0].content.parts[0].text;
            const usage = result.response.usageMetadata;

            if (job.type === 'ocr') {
              await db.collection('pages').updateOne(
                { id: pageId },
                {
                  $set: {
                    ocr: {
                      data: text,
                      updated_at: now,
                      model: job.model,
                      language: job.language,
                      source: 'batch_api',
                      batch_job_id: job.id,
                      input_tokens: usage?.promptTokenCount || 0,
                      output_tokens: usage?.candidatesTokenCount || 0,
                    },
                    updated_at: now,
                  },
                }
              );
            } else {
              await db.collection('pages').updateOne(
                { id: pageId },
                {
                  $set: {
                    translation: {
                      data: text,
                      updated_at: now,
                      model: job.model,
                      source_language: job.language,
                      target_language: 'English',
                      source: 'batch_api',
                      batch_job_id: job.id,
                      input_tokens: usage?.promptTokenCount || 0,
                      output_tokens: usage?.candidatesTokenCount || 0,
                    },
                    updated_at: now,
                  },
                }
              );
            }
            successCount++;
          }

          // Update job status
          await db.collection('batch_jobs').updateOne(
            { id: job.id },
            {
              $set: {
                status: 'saved',
                gemini_state: 'JOB_STATE_SUCCEEDED',
                completed_pages: successCount,
                failed_pages: failCount,
                completed_at: now,
                updated_at: now,
              },
            }
          );

          // Update book page counts
          await updateBookCounts(db, job.book_id);

          results.collected.push({
            job_id: job.id,
            book_title: job.book_title,
            pages_saved: successCount,
            pages_failed: failCount,
          });
          results.stats.jobs_completed++;
          results.stats.pages_saved += successCount;

        } else if (geminiStatus.state === 'JOB_STATE_RUNNING' || geminiStatus.state === 'JOB_STATE_PENDING') {
          // Still running
          results.stats.jobs_still_running++;

          // Update our status
          await db.collection('batch_jobs').updateOne(
            { id: job.id },
            {
              $set: {
                status: 'processing',
                gemini_state: geminiStatus.state,
                updated_at: new Date(),
              },
            }
          );

        } else if (geminiStatus.state === 'JOB_STATE_FAILED') {
          // Failed - mark it
          await db.collection('batch_jobs').updateOne(
            { id: job.id },
            {
              $set: {
                status: 'failed',
                gemini_state: geminiStatus.state,
                error: 'Gemini batch job failed',
                updated_at: new Date(),
              },
            }
          );
          results.errors.push(`Job ${job.id} failed: Gemini batch job failed`);
        }

      } catch (e) {
        const errMsg = e instanceof Error ? e.message : 'Unknown error';
        results.errors.push(`Job ${job.id}: ${errMsg}`);
      }
    }

    // ============================================
    // PHASE 2: Queue new work if capacity available
    // ============================================
    if (!skipQueue && results.stats.jobs_still_running < 10) {
      console.log('[cron] Phase 2: Queuing new work...');

      // Find books needing OCR (prioritize books with some progress)
      const booksNeedingWork = await db.collection('books').aggregate([
        {
          $lookup: {
            from: 'pages',
            localField: 'id',
            foreignField: 'book_id',
            as: 'pages',
          },
        },
        {
          $addFields: {
            needs_ocr: {
              $size: {
                $filter: {
                  input: '$pages',
                  cond: {
                    $or: [
                      { $eq: ['$$this.ocr.data', null] },
                      { $eq: ['$$this.ocr.data', ''] },
                      { $not: { $ifNull: ['$$this.ocr.data', false] } },
                    ],
                  },
                },
              },
            },
            needs_translation: {
              $size: {
                $filter: {
                  input: '$pages',
                  cond: {
                    $and: [
                      { $gt: [{ $strLenCP: { $ifNull: ['$$this.ocr.data', ''] } }, 0] },
                      {
                        $or: [
                          { $eq: ['$$this.translation.data', null] },
                          { $eq: ['$$this.translation.data', ''] },
                          { $not: { $ifNull: ['$$this.translation.data', false] } },
                        ],
                      },
                    ],
                  },
                },
              },
            },
            total_pages: { $size: '$pages' },
          },
        },
        {
          $match: {
            $or: [{ needs_ocr: { $gt: 0 } }, { needs_translation: { $gt: 0 } }],
          },
        },
        {
          $project: {
            id: 1,
            title: 1,
            display_title: 1,
            language: 1,
            needs_ocr: 1,
            needs_translation: 1,
            total_pages: 1,
          },
        },
        // Prioritize books that are partially done (some OCR, needs translation)
        { $sort: { needs_translation: -1, needs_ocr: 1 } },
        { $limit: maxNewJobs * 2 },
      ]).toArray();

      let jobsCreated = 0;

      for (const book of booksNeedingWork) {
        if (jobsCreated >= maxNewJobs) break;

        // Check if there's already an active job for this book
        const existingJob = await db.collection('batch_jobs').findOne({
          book_id: book.id,
          status: { $in: ['pending', 'processing'] },
        });

        if (existingJob) continue;

        const bookTitle = book.display_title || book.title;
        const bookId = book.id;

        // Prefer translation if OCR is done
        if (book.needs_translation > 0) {
          // Queue translation job via the existing endpoint
          try {
            const baseUrl = request.headers.get('host') || 'localhost:3000';
            const protocol = request.headers.get('x-forwarded-proto') || 'http';

            const response = await fetch(`${protocol}://${baseUrl}/api/batch-jobs`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'translate',
                bookId,
                bookTitle,
                language: book.language || 'Latin',
              }),
            });

            if (response.ok) {
              const data = await response.json();
              results.queued.push({
                book_id: bookId,
                book_title: bookTitle,
                type: 'translate',
                pages: data.job?.total_pages || book.needs_translation,
              });
              jobsCreated++;
              results.stats.new_jobs_created++;
            }
          } catch (e) {
            results.errors.push(`Queue translate ${bookTitle}: ${e instanceof Error ? e.message : 'Unknown'}`);
          }

        } else if (book.needs_ocr > 0) {
          // Queue OCR job
          try {
            const baseUrl = request.headers.get('host') || 'localhost:3000';
            const protocol = request.headers.get('x-forwarded-proto') || 'http';

            const response = await fetch(`${protocol}://${baseUrl}/api/batch-jobs`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'ocr',
                bookId,
                bookTitle,
                language: book.language || 'Latin',
              }),
            });

            if (response.ok) {
              const data = await response.json();
              results.queued.push({
                book_id: bookId,
                book_title: bookTitle,
                type: 'ocr',
                pages: data.job?.total_pages || book.needs_ocr,
              });
              jobsCreated++;
              results.stats.new_jobs_created++;
            }
          } catch (e) {
            results.errors.push(`Queue OCR ${bookTitle}: ${e instanceof Error ? e.message : 'Unknown'}`);
          }
        }
      }
    }

    const duration = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      duration_ms: duration,
      ...results,
      summary: {
        message: `Collected ${results.stats.pages_saved} pages from ${results.stats.jobs_completed} jobs. ${results.stats.jobs_still_running} jobs still running. Created ${results.stats.new_jobs_created} new jobs.`,
      },
    });

  } catch (error) {
    console.error('[cron] Error:', error);
    return NextResponse.json({
      error: 'Cron job failed',
      details: error instanceof Error ? error.message : 'Unknown error',
      partial_results: results,
    }, { status: 500 });
  }
}

/**
 * Update book page counts after saving OCR/translation results
 */
async function updateBookCounts(db: Awaited<ReturnType<typeof getDb>>, bookId: string) {
  const [counts] = await db.collection('pages').aggregate([
    { $match: { book_id: bookId } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        with_ocr: {
          $sum: {
            $cond: [
              { $and: [
                { $ne: ['$ocr.data', null] },
                { $ne: ['$ocr.data', ''] },
                { $ifNull: ['$ocr.data', false] }
              ]},
              1,
              0
            ]
          }
        },
        with_translation: {
          $sum: {
            $cond: [
              { $and: [
                { $ne: ['$translation.data', null] },
                { $ne: ['$translation.data', ''] },
                { $ifNull: ['$translation.data', false] }
              ]},
              1,
              0
            ]
          }
        },
      },
    },
  ]).toArray();

  if (counts) {
    await db.collection('books').updateOne(
      { id: bookId },
      {
        $set: {
          pages_count: counts.total,
          pages_ocr: counts.with_ocr,
          pages_translated: counts.with_translation,
          updated_at: new Date(),
        },
      }
    );
  }
}

// Also support POST for Vercel Cron (some setups prefer POST)
export async function POST(request: NextRequest) {
  return GET(request);
}
