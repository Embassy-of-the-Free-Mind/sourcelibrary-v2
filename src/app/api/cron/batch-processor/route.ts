import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

export const maxDuration = 300; // 5 minute timeout

const API_KEY = process.env.GEMINI_API_KEY;
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * POST /api/cron/batch-processor
 *
 * Monitor and process batch OCR/translation jobs.
 * Must be called every 6 hours (CRITICAL: results expire after 48h)
 *
 * This will:
 * 1. Sync job statuses from Gemini
 * 2. Download and save results from completed jobs
 * 3. Mark expired jobs
 * 4. Retry failed jobs
 *
 * Recommended: Set up Vercel cron
 * Add to vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/cron/batch-processor",
 *     "schedule": "0 */6 * * *"
 *   }]
 * }
 */
export async function POST(request: NextRequest) {
  const stats = {
    synced: 0,
    expired: 0,
    saved: 0,
    failed: 0,
    pagesProcessed: 0,
  };

  try {
    if (!API_KEY) {
      return NextResponse.json({ error: 'GEMINI_API_KEY not set' }, { status: 500 });
    }

    const db = await getDb();

    // Get all active batch jobs
    const jobs = await db
      .collection('batch_jobs')
      .find({
        status: { $in: ['processing', 'pending'] },
      })
      .toArray();

    if (jobs.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No active batch jobs',
        stats,
      });
    }

    for (const job of jobs) {
      try {
        // Check job status from Gemini
        const statusRes = await fetch(`${API_BASE}/${job.gemini_job_name}?key=${API_KEY}`);

        if (statusRes.status === 404) {
          // Results expired (48h window)
          await db.collection('batch_jobs').updateOne(
            { _id: job._id },
            {
              $set: {
                status: 'expired',
                updated_at: new Date(),
              },
            }
          );
          stats.expired++;
          continue;
        }

        if (!statusRes.ok) {
          console.error(`Error checking job ${job.gemini_job_name}:`, await statusRes.text());
          continue;
        }

        const jobData = await statusRes.json();
        const state = jobData.metadata?.state || 'UNKNOWN';

        // Update job status
        await db.collection('batch_jobs').updateOne(
          { _id: job._id },
          {
            $set: {
              gemini_state: state,
              updated_at: new Date(),
            },
          }
        );
        stats.synced++;

        // If completed, download and save results
        if (state === 'SUCCEEDED' || state === 'COMPLETED') {
          const resultsFile = jobData.metadata?.output?.responsesFile;
          const inlinedResults = jobData.response?.inlinedResponses;

          if (resultsFile) {
            // Download results file
            const downloadRes = await fetch(
              `${API_BASE}/${resultsFile}:download?key=${API_KEY}`
            );
            if (!downloadRes.ok) {
              console.error(`Failed to download results for ${job.gemini_job_name}`);
              continue;
            }

            const resultsText = await downloadRes.text();
            const results = resultsText
              .split('\n')
              .filter((line) => line.trim())
              .map((line) => JSON.parse(line));

            // Save OCR results to pages
            for (const result of results) {
              const pageId = result.custom_id;
              const ocrText =
                result.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';

              if (ocrText) {
                await db.collection('pages').updateOne(
                  { _id: new ObjectId(pageId) },
                  {
                    $set: {
                      'ocr.data': ocrText,
                      'ocr.model': 'gemini-2.5-flash',
                      updated_at: new Date(),
                    },
                  }
                );
                stats.pagesProcessed++;
                stats.saved++;
              }
            }
          } else if (inlinedResults && Array.isArray(inlinedResults)) {
            // Handle inline results
            for (const result of inlinedResults) {
              const pageId = result.custom_id;
              const ocrText =
                result.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';

              if (ocrText) {
                await db.collection('pages').updateOne(
                  { _id: new ObjectId(pageId) },
                  {
                    $set: {
                      'ocr.data': ocrText,
                      'ocr.model': 'gemini-2.5-flash',
                      updated_at: new Date(),
                    },
                  }
                );
                stats.pagesProcessed++;
                stats.saved++;
              }
            }
          }

          // Mark job as completed
          await db.collection('batch_jobs').updateOne(
            { _id: job._id },
            {
              $set: {
                status: 'saved',
                completed_pages: stats.pagesProcessed,
                updated_at: new Date(),
              },
            }
          );
        }
      } catch (error) {
        console.error(`Error processing job ${job.gemini_job_name}:`, error);
        stats.failed++;
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Batch processor completed',
      stats,
      nextStep: stats.synced > 0 ? 'Check back in 6 hours' : 'No jobs to process',
    });
  } catch (error) {
    console.error('Batch processor error:', error);
    return NextResponse.json(
      { error: 'Batch processor failed', details: String(error) },
      { status: 500 }
    );
  }
}
