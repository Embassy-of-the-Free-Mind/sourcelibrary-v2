import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { getBatchJobStatus, getBatchJobResults } from '@/lib/gemini-batch';

export const maxDuration = 300;

/**
 * POST /api/batch-jobs/save-results
 *
 * Download and save results from all completed batch jobs.
 * This is the bulk version of POST /api/batch-jobs/[id] with action 'complete'.
 *
 * Query params:
 * - limit: max jobs to process (default: 50)
 * - type: only save jobs of this type ('ocr', 'translate', 'ocr_resubmit')
 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const typeFilter = searchParams.get('type');

    const db = await getDb();

    console.log('[batch-jobs/save-results] Starting...');

    // Get completed jobs that haven't been saved
    const query: Record<string, unknown> = {
      status: 'completed',
      gemini_job_name: { $exists: true, $ne: null },
    };

    if (typeFilter) {
      query.type = typeFilter;
    }

    const jobs = await db.collection('batch_jobs')
      .find(query)
      .limit(limit)
      .toArray();

    console.log(`[batch-jobs/save-results] Found ${jobs.length} jobs to save`);

    const results = {
      saved: 0,
      failed: 0,
      total_pages_saved: 0,
      total_pages_failed: 0,
      job_results: [] as Array<{
        job_id: string;
        book_title: string;
        type: string;
        pages_saved: number;
        pages_failed: number;
        error?: string;
      }>,
    };

    for (const job of jobs) {
      try {
        console.log(`[batch-jobs/save-results] Processing: ${job.book_title} (${job.type})`);

        // Verify job is still complete
        const geminiStatus = await getBatchJobStatus(job.gemini_job_name);
        if (geminiStatus.state !== 'JOB_STATE_SUCCEEDED') {
          console.log(`[batch-jobs/save-results] Job ${job.id} not succeeded: ${geminiStatus.state}`);
          // Update status in case it changed
          await db.collection('batch_jobs').updateOne(
            { id: job.id },
            {
              $set: {
                status: geminiStatus.state === 'JOB_STATE_FAILED' ? 'failed' : 'processing',
                gemini_state: geminiStatus.state,
                updated_at: new Date(),
              },
            }
          );
          continue;
        }

        // Get results from Gemini
        const batchResults = await getBatchJobResults(job.gemini_job_name);
        console.log(`[batch-jobs/save-results] Got ${batchResults.length} results`);

        let saved = 0;
        let failed = 0;
        const now = new Date();

        for (const result of batchResults) {
          // Key is in metadata.key for inline responses, or just 'key' for file-based
          const pageId = (result as { metadata?: { key?: string }; key?: string }).metadata?.key || result.key;

          if (result.error) {
            failed++;
            continue;
          }

          const text = result.response?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!text) {
            failed++;
            continue;
          }

          const usage = result.response?.usageMetadata;

          if (job.type === 'ocr' || job.type === 'ocr_resubmit') {
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

          saved++;
        }

        // Update job status
        await db.collection('batch_jobs').updateOne(
          { id: job.id },
          {
            $set: {
              status: 'saved',
              completed_pages: saved,
              failed_pages: failed,
              completed_at: now,
              updated_at: now,
            },
          }
        );

        results.saved++;
        results.total_pages_saved += saved;
        results.total_pages_failed += failed;
        results.job_results.push({
          job_id: job.id,
          book_title: job.book_title,
          type: job.type,
          pages_saved: saved,
          pages_failed: failed,
        });

        console.log(`[batch-jobs/save-results] Saved ${saved} pages, ${failed} failed`);

      } catch (e) {
        console.error(`[batch-jobs/save-results] Error saving ${job.id}:`, e);
        results.failed++;
        results.job_results.push({
          job_id: job.id,
          book_title: job.book_title,
          type: job.type,
          pages_saved: 0,
          pages_failed: 0,
          error: e instanceof Error ? e.message : 'Unknown error',
        });
      }

      // Small delay between jobs
      await new Promise(r => setTimeout(r, 200));
    }

    console.log('[batch-jobs/save-results] Complete:', results);

    return NextResponse.json({
      success: true,
      summary: {
        jobs_saved: results.saved,
        jobs_failed: results.failed,
        pages_saved: results.total_pages_saved,
        pages_failed: results.total_pages_failed,
      },
      jobs: results.job_results,
      message: `Saved ${results.total_pages_saved} pages from ${results.saved} jobs`,
    });
  } catch (error) {
    console.error('[batch-jobs/save-results] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to save batch results',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/batch-jobs/save-results
 *
 * Show how many jobs are ready to have results saved.
 */
export async function GET() {
  try {
    const db = await getDb();

    const readyJobs = await db.collection('batch_jobs')
      .find({
        status: 'completed',
        gemini_job_name: { $exists: true, $ne: null },
      })
      .project({ id: 1, book_title: 1, type: 1, total_pages: 1 })
      .toArray();

    const byType: Record<string, number> = {};
    let totalPages = 0;

    for (const job of readyJobs) {
      byType[job.type] = (byType[job.type] || 0) + 1;
      totalPages += job.total_pages || 0;
    }

    return NextResponse.json({
      ready_jobs: readyJobs.length,
      total_pages: totalPages,
      by_type: byType,
      jobs: readyJobs.map(j => ({
        id: j.id,
        book_title: j.book_title,
        type: j.type,
        pages: j.total_pages,
      })),
      action: 'POST /api/batch-jobs/save-results',
    });
  } catch (error) {
    console.error('[batch-jobs/save-results] Error:', error);
    return NextResponse.json(
      { error: 'Failed to get ready jobs' },
      { status: 500 }
    );
  }
}
