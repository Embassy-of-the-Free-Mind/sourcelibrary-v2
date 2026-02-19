import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { fetchBatchJobWithResults } from '@/lib/gemini-batch';
import { logGeminiCall } from '@/lib/gemini-logger';
import { PROMPT_VERSION, extractPageType, extractColumns, parseDetectedImages, parseMultiPageOcr } from '@/lib/types/prompts/defaults';
import { extractTranslationMetadata } from '@/lib/translation-metadata';
import { verifyCronAuth } from '@/lib/cron-auth';
import { createSnapshotIfNeeded } from '@/lib/snapshots';

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
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const startTime = Date.now();

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
        status: { $in: ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] },
        $or: [
          { job_name: { $exists: true, $nin: [null, ''] } },
          { gemini_job_name: { $exists: true, $nin: [null, ''] } }
        ]
      })
      .toArray();

    results.stats.jobs_checked = pendingJobs.length;

    // Time budget: stop collecting before Vercel kills us (leave 30s buffer)
    const TIME_BUDGET_MS = (maxDuration - 30) * 1000;

    for (const job of pendingJobs) {
      // Check time budget before starting a new job
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        console.log(`[cron] Time budget exhausted after ${results.stats.jobs_completed} jobs collected. ${pendingJobs.length - results.stats.jobs_completed - results.stats.jobs_pending - results.stats.jobs_processing} jobs skipped.`);
        break;
      }
      try {
        // Support both job_name (new) and gemini_job_name (old)
        const jobName = job.job_name || job.gemini_job_name;
        if (!jobName) {
          console.warn(`[cron] Job ${job.id || String(job._id)} has no job_name or gemini_job_name`);
          continue;
        }

        // Single API call: fetch status + results together (avoids double-fetch)
        const { status: geminiStatus, results: batchResults } = await fetchBatchJobWithResults(jobName);

        if (geminiStatus.state === 'JOB_STATE_SUCCEEDED') {
          // Job complete - collect results
          console.log(`[cron] Collecting results for ${job.id || String(job._id)} (${job.book_title})`);

          if (!batchResults || batchResults.length === 0) {
            results.errors.push(`Job ${job.id || String(job._id)}: succeeded but no results returned`);
            continue;
          }
          let successCount = 0;
          let failCount = 0;
          const now = new Date();

          const pageIds = job.page_ids || [];
          const isMultiPage = (job.pages_per_request || 1) > 1;

          // Safety check for single-page mode: response count must match page count
          if (!isMultiPage && pageIds.length > 0 && batchResults.length !== pageIds.length) {
            console.warn(`[cron] Response count (${batchResults.length}) != page count (${pageIds.length}) for job ${job.id || String(job._id)}. Skipping to avoid mismatched data.`);
            results.errors.push(`Job ${job.id || String(job._id)}: response count mismatch (${batchResults.length} vs ${pageIds.length})`);
            continue;
          }

          // Build flat list of { pageId, text, usage } from responses
          const pageResultsList: Array<{ pageId: string; text: string; usage?: Record<string, number> }> = [];

          if (isMultiPage && job.type === 'ocr') {
            // Multi-page OCR: parse <page id="...">...</page> blocks from each response
            console.log(`[cron] Multi-page OCR: ${batchResults.length} responses for ${pageIds.length} pages (${job.pages_per_request} pages/request) — job ${job.id || String(job._id)}`);
            for (let ri = 0; ri < batchResults.length; ri++) {
              const result = batchResults[ri];
              if (result.error) {
                console.warn(`[cron] Response ${ri}: error — ${JSON.stringify(result.error).slice(0, 200)}`);
                failCount++;
                continue;
              }
              if (!result.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
                console.warn(`[cron] Response ${ri}: empty (no text in candidate)`);
                failCount++;
                continue;
              }
              const responseText = result.response.candidates[0].content.parts[0].text;
              const usage = result.response.usageMetadata;
              const parsed = parseMultiPageOcr(responseText);
              console.log(`[cron] Response ${ri}: parsed ${parsed.size} pages from ${responseText.length} chars`);
              if (parsed.size === 0) {
                console.warn(`[cron] Response ${ri}: no <page> tags found. First 500 chars: ${responseText.slice(0, 500)}`);
                failCount++;
              }
              for (const [pageId, ocrText] of parsed) {
                pageResultsList.push({ pageId, text: ocrText, usage });
              }
            }
          } else {
            // Single-page mode: match by metadata key or positional
            for (let idx = 0; idx < batchResults.length; idx++) {
              const result = batchResults[idx];
              const pageId = result.metadata?.key || (pageIds[idx]);

              if (!pageId) {
                console.warn(`[cron] No page ID for result idx ${idx} (job ${job.id || String(job._id)})`);
                failCount++;
                continue;
              }

              if (result.error || !result.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
                failCount++;
                continue;
              }

              pageResultsList.push({
                pageId,
                text: result.response.candidates[0].content.parts[0].text,
                usage: result.response.usageMetadata,
              });
            }
          }

          // Log collection summary
          if (isMultiPage && job.type === 'ocr') {
            const foundIds = new Set(pageResultsList.map(r => r.pageId));
            const missingIds = pageIds.filter((id: string) => !foundIds.has(id));
            console.log(`[cron] Collection summary for ${job.id || String(job._id)}: ${pageResultsList.length}/${pageIds.length} pages parsed, ${missingIds.length} missing${missingIds.length > 0 ? ': ' + missingIds.join(', ') : ''}`);
          }

          // Save each page result
          for (const { pageId, text, usage } of pageResultsList) {
            // Hallucination guard: skip pages with excessive text
            if (text.length > 25000) {
              console.warn(`[cron] Page ${pageId} has ${text.length} chars — likely hallucination, skipping`);
              failCount++;
              continue;
            }

            if (job.type === 'ocr') {
              const pageType = extractPageType(text);
              const columns = extractColumns(text);
              const detectedImages = parseDetectedImages(text);

              await createSnapshotIfNeeded(pageId, 'pre_ocr', job.id || String(job._id));

              // Ensure page has an ocr object (some pages have ocr: null)
              await db.collection('pages').updateOne(
                { id: pageId, ocr: null },
                { $set: { ocr: {} } }
              );

              const updateResult = await db.collection('pages').updateOne(
                { id: pageId },
                {
                  $set: {
                    'ocr.data': text,
                    'ocr.updated_at': now,
                    'ocr.model': job.model,
                    'ocr.language': job.language,
                    'ocr.source': 'batch_api',
                    'ocr.prompt_version': job.prompt_version || PROMPT_VERSION,
                    'ocr.prompt_name': job.prompt_name || 'Standard OCR',
                    'ocr.batch_job_id': job.id || String(job._id),
                    ...((job.pages_per_request || 1) > 1 && { 'ocr.pages_per_request': job.pages_per_request }),
                    'ocr.input_tokens': usage?.promptTokenCount || 0,
                    'ocr.output_tokens': usage?.candidatesTokenCount || 0,
                    ...(pageType && { page_type: pageType }),
                    ...(columns && { columns }),
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
              const translationMeta = extractTranslationMetadata(text);

              await createSnapshotIfNeeded(pageId, 'pre_translate', job.id || String(job._id));

              // Ensure page has a translation object (some pages have translation: null)
              await db.collection('pages').updateOne(
                { id: pageId, translation: null },
                { $set: { translation: {} } }
              );

              const updateResult = await db.collection('pages').updateOne(
                { id: pageId },
                {
                  $set: {
                    'translation.data': text,
                    'translation.updated_at': now,
                    'translation.model': job.model,
                    'translation.source_language': job.language,
                    'translation.target_language': 'English',
                    'translation.source': 'batch_api',
                    'translation.prompt_version': job.prompt_version || PROMPT_VERSION,
                    'translation.prompt_name': job.prompt_name || 'Standard Translation',
                    'translation.batch_job_id': job.id || String(job._id),
                    'translation.input_tokens': usage?.promptTokenCount || 0,
                    'translation.output_tokens': usage?.candidatesTokenCount || 0,
                    ...translationMeta,
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

          // Update job status with collection diagnostics
          const collectionMeta: Record<string, unknown> = {
            status: 'saved',
            gemini_state: 'JOB_STATE_SUCCEEDED',
            completed_pages: successCount,
            failed_pages: failCount,
            results_collected: true,
            success_count: successCount,
            fail_count: failCount,
            completed_at: now,
            updated_at: now,
          };
          if (isMultiPage && job.type === 'ocr') {
            const foundIds = new Set(pageResultsList.map(r => r.pageId));
            collectionMeta.collection_log = {
              responses: batchResults.length,
              pages_expected: pageIds.length,
              pages_parsed: pageResultsList.length,
              pages_missing: pageIds.filter((id: string) => !foundIds.has(id)),
            };
          }
          await db.collection('batch_jobs').updateOne(
            { _id: job._id },
            { $set: collectionMeta }
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
            batch_job_id: job.id || String(job._id),
            gemini_job_name: jobName,
            input_tokens: totalInputTokens,
            output_tokens: totalOutputTokens,
            status: successCount > 0 ? 'success' : 'failed',
            endpoint: '/api/cron/process-batches',
            pages_per_request: job.pages_per_request,
          });

          results.collected.push({
            job_id: job.id || String(job._id),
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
            { _id: job._id },
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
            { _id: job._id },
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
            { _id: job._id },
            {
              $set: {
                status: 'failed',
                gemini_state: geminiStatus.state,
                error: 'Gemini batch job failed',
                updated_at: new Date(),
              },
            }
          );
          if (job.parent_job_id) {
            await updateParentJobProgress(db, job.parent_job_id);
          }
          results.errors.push(`Job ${job.id || String(job._id)} failed: Gemini batch job failed`);

        } else if (geminiStatus.state === 'JOB_STATE_CANCELLED' || (geminiStatus.state as string) === 'BATCH_STATE_CANCELLED') {
          // Cancelled — terminal state
          await db.collection('batch_jobs').updateOne(
            { _id: job._id },
            {
              $set: {
                status: 'cancelled',
                gemini_state: geminiStatus.state,
                updated_at: new Date(),
              },
            }
          );
          if (job.parent_job_id) {
            await updateParentJobProgress(db, job.parent_job_id);
          }
          results.errors.push(`Job ${job.id || String(job._id)} cancelled`);

        } else if (geminiStatus.state === 'JOB_STATE_EXPIRED' || (geminiStatus.state as string) === 'BATCH_STATE_EXPIRED') {
          // Expired (7-day Gemini limit) — terminal state
          await db.collection('batch_jobs').updateOne(
            { _id: job._id },
            {
              $set: {
                status: 'failed',
                gemini_state: geminiStatus.state,
                error: 'Gemini batch job expired (7-day limit)',
                updated_at: new Date(),
              },
            }
          );
          if (job.parent_job_id) {
            await updateParentJobProgress(db, job.parent_job_id);
          }
          results.errors.push(`Job ${job.id || String(job._id)} expired: exceeded 7-day Gemini limit`);
        }

      } catch (e) {
        const errMsg = e instanceof Error ? e.message : 'Unknown error';
        results.errors.push(`Job ${job.id || String(job._id)}: ${errMsg}`);
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
    // Child is done if status is saved, completed, failed, or cancelled
    const childIsDone = ['saved', 'completed', 'failed', 'cancelled'].includes(child.status);

    if (!childIsDone) {
      allChildrenDone = false;
    }

    if (child.status === 'saved' || child.status === 'completed') {
      // Use actual completed/failed counts when available, fall back to page_count
      progress.completed += child.completed_pages ?? child.page_count ?? 0;
      progress.failed += child.failed_pages ?? 0;
    } else if (child.status === 'failed' || child.status === 'cancelled') {
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
