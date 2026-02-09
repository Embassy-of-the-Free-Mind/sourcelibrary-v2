import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { getBatchJobStatus, getBatchJobResults } from '@/lib/gemini-batch';
import { logGeminiCall } from '@/lib/gemini-logger';
import { PROMPT_VERSION } from '@/lib/types/prompts/defaults';

export const maxDuration = 300;

/**
 * GET /api/cron/process-batches
 *
 * Automated batch processing cron job.
 * Collects results from completed Gemini batch jobs.
 *
 * For submitting new work, use POST /api/admin/campaign instead.
 *
 * Triggered by Vercel Cron (every 2 hours) or manual call.
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();

  // Verify cron secret in production (optional security)
  const cronSecret = request.headers.get('x-cron-secret');
  const expectedSecret = process.env.CRON_SECRET;
  if (expectedSecret && cronSecret !== expectedSecret) {
    // Allow without secret for manual testing, but log it
    console.log('[cron] Running without cron secret verification');
  }

  const results = {
    collected: [] as Array<{ job_id: string; book_title: string; pages_saved: number; pages_failed: number }>,
    errors: [] as string[],
    stats: {
      jobs_checked: 0,
      jobs_completed: 0,
      jobs_still_running: 0,
      pages_saved: 0,
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
                      prompt_version: job.prompt_version || PROMPT_VERSION,
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
                      prompt_version: job.prompt_version || PROMPT_VERSION,
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

          // Calculate total tokens from results
          let totalInputTokens = 0;
          let totalOutputTokens = 0;
          for (const result of batchResults) {
            const usage = result.response?.usageMetadata;
            if (usage) {
              totalInputTokens += usage.promptTokenCount || 0;
              totalOutputTokens += usage.candidatesTokenCount || 0;
            }
          }

          // Log batch job completion
          await logGeminiCall({
            type: job.type === 'ocr' ? 'ocr' : 'translate',
            mode: 'batch',
            model: job.model,
            book_id: job.book_id,
            book_title: job.book_title,
            page_ids: job.page_ids,
            page_count: successCount,
            batch_job_id: job.id,
            gemini_job_name: job.gemini_job_name,
            input_tokens: totalInputTokens,
            output_tokens: totalOutputTokens,
            status: successCount > 0 ? 'success' : 'failed',
            endpoint: '/api/cron/process-batches',
          });

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

    // Phase 2 (auto-queue new work) removed — use POST /api/admin/campaign instead.

    const duration = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      duration_ms: duration,
      ...results,
      summary: {
        message: `Collected ${results.stats.pages_saved} pages from ${results.stats.jobs_completed} jobs. ${results.stats.jobs_still_running} jobs still running.`,
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
