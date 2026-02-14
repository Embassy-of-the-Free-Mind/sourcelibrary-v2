import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { getBatchJobStatus, getBatchJobResults } from '@/lib/gemini-batch';
import { logGeminiCall } from '@/lib/gemini-logger';
import { PROMPT_VERSION, extractPageType, parseDetectedImages } from '@/lib/types/prompts/defaults';

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
      jobs_pending: 0,
      jobs_processing: 0,
      pages_saved: 0,
    },
  };

  try {
    const db = await getDb();

    // ============================================
    // PHASE 1: Collect results from completed jobs
    // ============================================

    // Query only child jobs (those with parent_job_id) and existing standalone jobs
    // New parent-child jobs use job_name, old jobs use gemini_job_name
    const pendingJobs = await db.collection('batch_jobs')
      .find({
        status: { $in: ['pending', 'processing'] },
        $or: [
          { job_name: { $exists: true, $nin: [null, ''] } },
          { gemini_job_name: { $exists: true, $nin: [null, ''] } }
        ]
      })
      .toArray();

    results.stats.jobs_checked = pendingJobs.length;

    for (const job of pendingJobs) {
      try {
        // Support both job_name (new) and gemini_job_name (old)
        const jobName = job.job_name || job.gemini_job_name;
        if (!jobName) {
          console.warn(`[cron] Job ${job.id} has no job_name or gemini_job_name`);
          continue;
        }

        const geminiStatus = await getBatchJobStatus(jobName);

        if ((geminiStatus.state as string) === 'JOB_STATE_SUCCEEDED' || (geminiStatus.state as string) === 'BATCH_STATE_SUCCEEDED') {
          // Job complete - collect results
          console.log(`[cron] Collecting results for ${job.id} (${job.book_title})`);

          const batchResults = await getBatchJobResults(jobName);
          let successCount = 0;
          let failCount = 0;
          const now = new Date();          

          for (const result of batchResults) {
            // Extract page ID from metadata
            const pageId = result.metadata?.key;

            if (!pageId) {
              console.warn('[cron] No page ID found in result:', JSON.stringify(result, null, 2));
              failCount++;
              continue;
            }            

            if (result.error || !result.response?.candidates?.[0]?.content?.parts?.[0]?.text) {              
              failCount++;
              continue;
            }

            const text = result.response.candidates[0].content.parts[0].text;
            const usage = result.response.usageMetadata;            

            if (job.type === 'ocr') {
              const pageType = extractPageType(text);
              const detectedImages = parseDetectedImages(text);
              const updateResult = await db.collection('pages').updateOne(
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
                    ...(pageType && { page_type: pageType }),
                    ...(detectedImages.length > 0 && { detected_images: detectedImages }),
                    updated_at: now,
                  },
                }
              );              

              if (updateResult.matchedCount === 0) {
                console.warn(`[cron] Page ${pageId} not found in database!`);
                failCount++;
                continue;
              }
            } else {
              const updateResult = await db.collection('pages').updateOne(
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

              if (updateResult.matchedCount === 0) {
                console.warn(`[cron] Page ${pageId} not found in database!`);
                failCount++;
                continue;
              }
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

          // If this is a child job, update parent job progress
          if (job.parent_job_id) {
            await updateParentJobProgress(db, job.parent_job_id);
          }

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
            gemini_job_name: jobName,
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

        } else if (geminiStatus.state === 'JOB_STATE_PENDING') {
          // Job queued but not started yet
          results.stats.jobs_pending++;

          // Keep status as pending
          await db.collection('batch_jobs').updateOne(
            { id: job.id },
            {
              $set: {
                status: 'pending',
                gemini_state: geminiStatus.state,
                updated_at: new Date(),
              },
            }
          );

          // If this is a child job, update parent job progress
          if (job.parent_job_id) {
            await updateParentJobProgress(db, job.parent_job_id);
          }

        } else if (geminiStatus.state === 'JOB_STATE_RUNNING') {
          // Job actively processing
          results.stats.jobs_processing++;

          // Update status to processing
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

          // If this is a child job, update parent job progress
          if (job.parent_job_id) {
            await updateParentJobProgress(db, job.parent_job_id);
          }

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
        message: `Collected ${results.stats.pages_saved} pages from ${results.stats.jobs_completed} jobs. ${results.stats.jobs_processing} jobs processing, ${results.stats.jobs_pending} jobs pending.`,
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
 * Update parent job progress by aggregating child job statuses
 */
async function updateParentJobProgress(
  db: Awaited<ReturnType<typeof getDb>>,
  parentJobId: string
) {
  const parent = await db.collection('batch_jobs').findOne({ id: parentJobId });
  if (!parent || !parent.child_job_ids) return;

  // Get all child jobs
  const children = await db.collection('batch_jobs')
    .find({ id: { $in: parent.child_job_ids } })
    .toArray();

  // Aggregate progress
  const progress = {
    completed: 0,
    failed: 0,
    pending: 0,
    total: parent.total_pages
  };

  // Check if ALL children are done (success or fail)
  let allChildrenDone = true;
  let anyChildFailed = false;

  for (const child of children) {
    // Child is done if status is saved, completed, or failed
    const childIsDone = ['saved', 'completed', 'failed'].includes(child.status);

    if (!childIsDone) {
      allChildrenDone = false;
    }

    if (child.status === 'saved' || child.status === 'completed') {
      progress.completed += child.page_count || 0;
    } else if (child.status === 'failed') {
      progress.failed += child.page_count || 0;
      anyChildFailed = true;
    } else {
      progress.pending += child.page_count || 0;
    }
  }

  // Determine parent status
  let parentStatus: string;

  if (allChildrenDone) {
    // All children finished
    parentStatus = anyChildFailed || progress.failed > 0
      ? 'completed_with_errors'
      : 'completed';
  } else {
    // Some children still processing
    parentStatus = progress.completed > 0 ? 'processing' : 'pending';
  }

  const update: any = {
    progress,
    status: parentStatus,
    updated_at: new Date()
  };

  // Set completed_at if all done
  if (allChildrenDone && !parent.completed_at) {
    update.completed_at = new Date();
  }

  await db.collection('batch_jobs').updateOne(
    { id: parentJobId },
    { $set: update }
  );

  // Clear job from book when parent job completes
  if (allChildrenDone && parent.book_id) {
    await db.collection('books').updateOne(
      { id: parent.book_id },
      { $unset: { job: '' } }
    );
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
