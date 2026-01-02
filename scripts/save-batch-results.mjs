/**
 * Save completed batch job results to pages
 *
 * Logs all operations to:
 * - logs/batch-save.log (file)
 * - Console output
 */
import { config } from 'dotenv';
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
config({ path: '.env.prod' });
config({ path: '.env.local', override: true });

const API_KEY = process.env.GEMINI_API_KEY;
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const LOG_DIR = 'logs';
const LOG_FILE = path.join(LOG_DIR, 'batch-save.log');

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function log(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;
  console.log(message); // Console without timestamp for readability
  fs.appendFileSync(LOG_FILE, line + '\n');
}

async function getBatchResults(jobName) {
  // First get job details to find output
  const jobRes = await fetch(`${API_BASE}/${jobName}?key=${API_KEY}`);
  if (!jobRes.ok) throw new Error(`Failed to get job: ${await jobRes.text()}`);
  const job = await jobRes.json();

  // Check for file-based output (responsesFile - newer format)
  if (job.metadata?.output?.responsesFile) {
    const fileName = job.metadata.output.responsesFile;
    const fileRes = await fetch(
      `https://generativelanguage.googleapis.com/download/v1beta/${fileName}:download?alt=media&key=${API_KEY}`
    );
    if (!fileRes.ok) throw new Error(`Failed to download results from ${fileName}`);
    const text = await fileRes.text();
    return text.trim().split('\n').filter(l => l).map(l => JSON.parse(l));
  }

  // Check for legacy destFile
  if (job.metadata?.destFile) {
    const fileName = job.metadata.destFile;
    const fileRes = await fetch(
      `https://generativelanguage.googleapis.com/download/v1beta/${fileName}:download?alt=media&key=${API_KEY}`
    );
    if (!fileRes.ok) throw new Error(`Failed to download results: ${await fileRes.text()}`);
    const text = await fileRes.text();
    return text.trim().split('\n').filter(l => l).map(l => JSON.parse(l));
  }

  // Check for inline responses (double nested in metadata.output)
  if (job.metadata?.output?.inlinedResponses?.inlinedResponses) {
    return job.metadata.output.inlinedResponses.inlinedResponses;
  }

  // Alternative location
  if (job.response?.inlinedResponses) {
    return job.response.inlinedResponses;
  }

  throw new Error('No results found in job');
}

async function saveResults() {
  ensureLogDir();

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB);

  log('=== Saving Batch Results ===');
  log(`Started at: ${new Date().toISOString()}`);

  // Get completed jobs that haven't been saved
  // Handle both state naming conventions (BATCH_STATE_* and JOB_STATE_*)
  const jobs = await db.collection('batch_jobs')
    .find({
      gemini_state: { $in: ['BATCH_STATE_SUCCEEDED', 'JOB_STATE_SUCCEEDED'] },
      status: { $ne: 'saved' }
    })
    .toArray();

  log(`Found ${jobs.length} completed jobs to save`);

  let totalSaved = 0;
  let totalFailed = 0;
  let jobsProcessed = 0;

  for (const job of jobs) {
    try {
      log(`\nProcessing: ${job.book_title} (${job.type})`);

      const results = await getBatchResults(job.gemini_job_name);
      log(`  Got ${results.length} results`);

      let saved = 0;
      let failed = 0;
      const now = new Date();

      for (const result of results) {
        // Key is in metadata.key for inline responses
        const pageId = result.metadata?.key || result.key;

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

      log(`  Saved: ${saved}, Failed: ${failed}`);
      totalSaved += saved;
      totalFailed += failed;
      jobsProcessed++;

    } catch (e) {
      log(`  Error: ${e.message}`);
      // Mark as failed so we don't retry infinitely
      await db.collection('batch_jobs').updateOne(
        { id: job.id },
        {
          $set: {
            status: 'failed',
            error_message: e.message,
            updated_at: new Date(),
          },
        }
      );
    }
  }

  log(`\n=== Save Complete ===`);
  log(`Jobs processed: ${jobsProcessed}`);
  log(`Total pages saved: ${totalSaved}`);
  log(`Total pages failed: ${totalFailed}`);
  log(`Completed at: ${new Date().toISOString()}`);

  await client.close();
}

saveResults().catch(e => {
  log(`FATAL ERROR: ${e.message}`);
  console.error('Error:', e);
  process.exit(1);
});
