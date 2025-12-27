import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import {
  getBatchJobStatus,
  getBatchJobResults,
  cancelBatchJob,
} from '@/lib/gemini-batch';

export const maxDuration = 300;

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/batch-jobs/[id]
 *
 * Get status of a batch job, syncing with Gemini API
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const db = await getDb();

    const job = await db.collection('batch_jobs').findOne({ id });
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // If job is still pending/processing, check Gemini status
    if (job.status === 'pending' || job.status === 'processing') {
      try {
        const geminiStatus = await getBatchJobStatus(job.gemini_job_name);

        // Map Gemini state to our status
        let newStatus = job.status;
        if (geminiStatus.state === 'JOB_STATE_RUNNING') {
          newStatus = 'processing';
        } else if (geminiStatus.state === 'JOB_STATE_SUCCEEDED') {
          newStatus = 'completed';
        } else if (geminiStatus.state === 'JOB_STATE_FAILED') {
          newStatus = 'failed';
        } else if (geminiStatus.state === 'JOB_STATE_CANCELLED') {
          newStatus = 'cancelled';
        } else if (geminiStatus.state === 'JOB_STATE_EXPIRED') {
          newStatus = 'expired';
        }

        // Update our database
        if (newStatus !== job.status || geminiStatus.state !== job.gemini_state) {
          await db.collection('batch_jobs').updateOne(
            { id },
            {
              $set: {
                status: newStatus,
                gemini_state: geminiStatus.state,
                gemini_stats: geminiStatus.stats,
                updated_at: new Date(),
              },
            }
          );
          job.status = newStatus;
          job.gemini_state = geminiStatus.state;
          job.gemini_stats = geminiStatus.stats;
        }
      } catch (e) {
        console.warn(`[batch-jobs] Could not sync Gemini status for ${id}:`, e);
      }
    }

    return NextResponse.json({
      job: {
        id: job.id,
        type: job.type,
        book_id: job.book_id,
        book_title: job.book_title,
        model: job.model,
        language: job.language,
        status: job.status,
        gemini_state: job.gemini_state,
        gemini_job_name: job.gemini_job_name,
        total_pages: job.total_pages,
        completed_pages: job.completed_pages,
        failed_pages: job.failed_pages,
        page_ids: job.page_ids,
        gemini_stats: job.gemini_stats,
        created_at: job.created_at,
        updated_at: job.updated_at,
        completed_at: job.completed_at,
        error: job.error,
      },
    });
  } catch (error) {
    console.error('[batch-jobs] Get error:', error);
    return NextResponse.json(
      { error: 'Failed to get batch job' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/batch-jobs/[id]
 *
 * Actions on a batch job:
 * - action: 'complete' - Download results and save to pages
 * - action: 'cancel' - Cancel the job
 * - action: 'refresh' - Force refresh status from Gemini
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { action } = await request.json();
    const db = await getDb();

    const job = await db.collection('batch_jobs').findOne({ id });
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    if (action === 'cancel') {
      // Cancel the Gemini job
      try {
        await cancelBatchJob(job.gemini_job_name);
      } catch (e) {
        console.warn(`[batch-jobs] Could not cancel Gemini job:`, e);
      }

      await db.collection('batch_jobs').updateOne(
        { id },
        {
          $set: {
            status: 'cancelled',
            gemini_state: 'JOB_STATE_CANCELLED',
            updated_at: new Date(),
          },
        }
      );

      return NextResponse.json({
        success: true,
        message: 'Job cancelled',
      });
    }

    if (action === 'refresh') {
      // Force refresh from Gemini
      const geminiStatus = await getBatchJobStatus(job.gemini_job_name);

      let newStatus = job.status;
      if (geminiStatus.state === 'JOB_STATE_RUNNING') {
        newStatus = 'processing';
      } else if (geminiStatus.state === 'JOB_STATE_SUCCEEDED') {
        newStatus = 'completed';
      } else if (geminiStatus.state === 'JOB_STATE_FAILED') {
        newStatus = 'failed';
      } else if (geminiStatus.state === 'JOB_STATE_CANCELLED') {
        newStatus = 'cancelled';
      }

      await db.collection('batch_jobs').updateOne(
        { id },
        {
          $set: {
            status: newStatus,
            gemini_state: geminiStatus.state,
            gemini_stats: geminiStatus.stats,
            updated_at: new Date(),
          },
        }
      );

      return NextResponse.json({
        success: true,
        status: newStatus,
        gemini_state: geminiStatus.state,
        stats: geminiStatus.stats,
      });
    }

    if (action === 'complete') {
      // Download results and save to pages
      if (job.status === 'saved') {
        return NextResponse.json({
          message: 'Results already saved',
          completed_pages: job.completed_pages,
        });
      }

      // Check if job is complete
      const geminiStatus = await getBatchJobStatus(job.gemini_job_name);

      if (geminiStatus.state !== 'JOB_STATE_SUCCEEDED') {
        return NextResponse.json(
          {
            error: 'Job not complete',
            gemini_state: geminiStatus.state,
            message:
              geminiStatus.state === 'JOB_STATE_RUNNING'
                ? 'Job still processing, try again later'
                : `Job in state: ${geminiStatus.state}`,
          },
          { status: 400 }
        );
      }

      console.log(`[batch-jobs] Downloading results for ${id}`);

      // Get results
      const results = await getBatchJobResults(job.gemini_job_name);

      console.log(`[batch-jobs] Got ${results.length} results`);

      // Save results to pages
      let successCount = 0;
      let failCount = 0;
      const now = new Date();

      for (const result of results) {
        const pageId = result.key;

        if (result.error) {
          console.error(
            `[batch-jobs] Page ${pageId} error:`,
            result.error.message
          );
          failCount++;
          continue;
        }

        if (!result.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
          console.error(`[batch-jobs] Page ${pageId} no response text`);
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
        { id },
        {
          $set: {
            status: 'saved',
            completed_pages: successCount,
            failed_pages: failCount,
            completed_at: now,
            updated_at: now,
          },
        }
      );

      console.log(
        `[batch-jobs] Saved ${successCount} pages, ${failCount} failed`
      );

      return NextResponse.json({
        success: true,
        completed_pages: successCount,
        failed_pages: failCount,
        message: `Saved ${successCount} pages to database`,
      });
    }

    return NextResponse.json(
      { error: 'Invalid action. Use: complete, cancel, or refresh' },
      { status: 400 }
    );
  } catch (error) {
    console.error('[batch-jobs] Action error:', error);
    return NextResponse.json(
      {
        error: 'Failed to perform action',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/batch-jobs/[id]
 *
 * Delete a batch job record (does not cancel Gemini job)
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const db = await getDb();

    const result = await db.collection('batch_jobs').deleteOne({ id });

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: 'Job deleted',
    });
  } catch (error) {
    console.error('[batch-jobs] Delete error:', error);
    return NextResponse.json(
      { error: 'Failed to delete job' },
      { status: 500 }
    );
  }
}
