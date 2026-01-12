import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { listBatchJobs, getBatchJobResults } from '@/lib/gemini-batch';

export const maxDuration = 300;

/**
 * GET /api/batch-jobs/reconcile
 *
 * List all Gemini batch jobs and attempt to match them to our database.
 * Shows jobs that have results but aren't linked.
 */
export async function GET() {
  try {
    const db = await getDb();

    // Get all Gemini jobs
    const geminiJobs = await listBatchJobs(200);

    // Get our DB jobs with gemini_job_name
    const dbJobs = await db.collection('batch_jobs')
      .find({ gemini_job_name: { $exists: true, $nin: [null, ''] } })
      .project({ id: 1, gemini_job_name: 1, book_id: 1, status: 1 })
      .toArray();

    const linkedNames = new Set(dbJobs.map(j => j.gemini_job_name));

    // Find unlinked Gemini jobs
    const unlinked = geminiJobs.filter(gj => !linkedNames.has(gj.name));

    // Categorize by state
    const byState: Record<string, number> = {};
    for (const job of geminiJobs) {
      byState[job.state] = (byState[job.state] || 0) + 1;
    }

    return NextResponse.json({
      gemini_jobs_total: geminiJobs.length,
      db_jobs_linked: dbJobs.length,
      unlinked_count: unlinked.length,
      by_state: byState,
      unlinked_jobs: unlinked.map(j => ({
        name: j.name,
        displayName: j.displayName,
        state: j.state,
        createTime: j.createTime,
        stats: j.stats,
      })),
    });
  } catch (error) {
    console.error('[reconcile] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to reconcile jobs',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/batch-jobs/reconcile
 *
 * Attempt to reconnect unlinked Gemini jobs by matching displayName to book_id.
 * For succeeded jobs, downloads and saves results directly.
 *
 * Query params:
 * - dry_run: true to just show what would be done
 * - limit: max jobs to process (default: 20)
 */
export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const dryRun = searchParams.get('dry_run') === 'true';
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    const db = await getDb();

    // Get all Gemini jobs
    const geminiJobs = await listBatchJobs(200);

    // Get linked job names
    const dbJobs = await db.collection('batch_jobs')
      .find({ gemini_job_name: { $exists: true, $nin: [null, ''] } })
      .project({ gemini_job_name: 1 })
      .toArray();

    const linkedNames = new Set(dbJobs.map(j => j.gemini_job_name));

    // Find succeeded unlinked jobs
    const succeededUnlinked = geminiJobs.filter(
      gj => !linkedNames.has(gj.name) && gj.state === 'JOB_STATE_SUCCEEDED'
    );

    console.log(`[reconcile] Found ${succeededUnlinked.length} succeeded unlinked jobs`);

    const results = {
      processed: 0,
      saved: 0,
      pages_saved: 0,
      errors: [] as string[],
      jobs: [] as Array<{ name: string; displayName: string; pages_saved: number; error?: string }>,
    };

    for (const geminiJob of succeededUnlinked.slice(0, limit)) {
      try {
        console.log(`[reconcile] Processing ${geminiJob.displayName || geminiJob.name}`);

        if (dryRun) {
          results.jobs.push({
            name: geminiJob.name,
            displayName: geminiJob.displayName || '',
            pages_saved: geminiJob.stats?.successCount || 0,
          });
          results.processed++;
          continue;
        }

        // Get results from Gemini
        const batchResults = await getBatchJobResults(geminiJob.name);

        let pagesSaved = 0;
        const now = new Date();

        // Parse displayName to get job type and book info
        // Format: ocr-{bookId.slice(0,8)}-{timestamp} or translate-{bookId.slice(0,8)}-{timestamp}
        const isTranslate = geminiJob.displayName?.startsWith('translate');
        const isOcr = geminiJob.displayName?.startsWith('ocr');

        for (const result of batchResults) {
          const pageId = (result as { metadata?: { key?: string }; key?: string }).metadata?.key || result.key;

          if (result.error || !result.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
            continue;
          }

          const text = result.response.candidates[0].content.parts[0].text;
          const usage = result.response.usageMetadata;

          // Check if page exists and needs this data
          const page = await db.collection('pages').findOne({ id: pageId });
          if (!page) continue;

          if (isOcr || (!isTranslate && !page.ocr?.data)) {
            await db.collection('pages').updateOne(
              { id: pageId },
              {
                $set: {
                  ocr: {
                    data: text,
                    updated_at: now,
                    model: 'gemini-3-flash-preview',
                    source: 'batch_api_reconcile',
                    input_tokens: usage?.promptTokenCount || 0,
                    output_tokens: usage?.candidatesTokenCount || 0,
                  },
                  updated_at: now,
                },
              }
            );
            pagesSaved++;
          } else if (isTranslate) {
            await db.collection('pages').updateOne(
              { id: pageId },
              {
                $set: {
                  translation: {
                    data: text,
                    updated_at: now,
                    model: 'gemini-3-flash-preview',
                    target_language: 'English',
                    source: 'batch_api_reconcile',
                    input_tokens: usage?.promptTokenCount || 0,
                    output_tokens: usage?.candidatesTokenCount || 0,
                  },
                  updated_at: now,
                },
              }
            );
            pagesSaved++;
          }
        }

        results.jobs.push({
          name: geminiJob.name,
          displayName: geminiJob.displayName || '',
          pages_saved: pagesSaved,
        });
        results.processed++;
        results.saved++;
        results.pages_saved += pagesSaved;

      } catch (e) {
        const errMsg = e instanceof Error ? e.message : 'Unknown error';
        results.errors.push(`${geminiJob.name}: ${errMsg}`);
        results.jobs.push({
          name: geminiJob.name,
          displayName: geminiJob.displayName || '',
          pages_saved: 0,
          error: errMsg,
        });
      }
    }

    return NextResponse.json({
      success: true,
      dry_run: dryRun,
      ...results,
      message: dryRun
        ? `Would process ${results.processed} jobs`
        : `Saved ${results.pages_saved} pages from ${results.saved} jobs`,
    });
  } catch (error) {
    console.error('[reconcile] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to reconcile jobs',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
