#!/usr/bin/env node
/**
 * Cron job for batch OCR/translation processing
 *
 * This script should be run every 6-12 hours to:
 * 1. Sync job statuses from Gemini API
 * 2. Save results from completed jobs to the database
 * 3. Mark expired jobs (Gemini only keeps results for 2 days)
 *
 * Usage:
 *   node scripts/cron-batch-processor.mjs
 *
 * Recommended cron schedule (every 6 hours):
 *   0 0,6,12,18 * * * cd /path/to/sourcelibrary-v2 && node scripts/cron-batch-processor.mjs
 */
import { config } from 'dotenv';
import { MongoClient } from 'mongodb';
config({ path: '.env.prod' });
config({ path: '.env.local', override: true });

const API_KEY = process.env.GEMINI_API_KEY;
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Stats tracking
const stats = {
  synced: 0,
  expired: 0,
  saved: 0,
  failed: 0,
  pagesProcessed: 0,
};

async function getBatchStatus(jobName) {
  const res = await fetch(`${API_BASE}/${jobName}?key=${API_KEY}`);
  if (!res.ok) {
    const err = await res.text();
    if (err.includes('404') || err.includes('NOT_FOUND')) {
      return { expired: true };
    }
    throw new Error(`Failed to get status: ${err}`);
  }
  const data = await res.json();
  return {
    name: data.name,
    state: data.metadata?.state || 'UNKNOWN',
    stats: data.metadata?.batchStats || {},
    createTime: data.metadata?.createTime,
    output: data.metadata?.output,
    destFile: data.metadata?.destFile,
    response: data.response,
  };
}

async function getResults(jobData) {
  // Check for file-based output (responsesFile)
  if (jobData.output?.responsesFile) {
    const fileName = jobData.output.responsesFile;
    const fileRes = await fetch(
      `https://generativelanguage.googleapis.com/download/v1beta/${fileName}:download?alt=media&key=${API_KEY}`
    );
    if (!fileRes.ok) throw new Error(`Failed to download results from ${fileName}`);
    const text = await fileRes.text();
    return text.trim().split('\n').filter(l => l).map(l => JSON.parse(l));
  }

  // Check for legacy destFile
  if (jobData.destFile) {
    const fileRes = await fetch(
      `https://generativelanguage.googleapis.com/download/v1beta/${jobData.destFile}:download?alt=media&key=${API_KEY}`
    );
    if (!fileRes.ok) throw new Error(`Failed to download results`);
    const text = await fileRes.text();
    return text.trim().split('\n').filter(l => l).map(l => JSON.parse(l));
  }

  // Check for inline responses (double nested)
  if (jobData.output?.inlinedResponses?.inlinedResponses) {
    return jobData.output.inlinedResponses.inlinedResponses;
  }

  // Alternative location
  if (jobData.response?.inlinedResponses) {
    return jobData.response.inlinedResponses;
  }

  throw new Error('No results found in job');
}

async function processJob(db, job, geminiData) {
  const results = await getResults(geminiData);
  const now = new Date();
  let saved = 0, failed = 0;

  for (const result of results) {
    const pageId = result.metadata?.key || result.key;
    if (result.error || !pageId) {
      failed++;
      continue;
    }

    const text = result.response?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      failed++;
      continue;
    }

    const usage = result.response?.usageMetadata;
    const updateData = job.type === 'ocr' ? {
      ocr: {
        data: text,
        updated_at: now,
        model: job.model,
        language: job.language,
        source: 'batch_api',
        batch_job_id: job.id,
        input_tokens: usage?.promptTokenCount || 0,
        output_tokens: usage?.candidatesTokenCount || 0,
      }
    } : {
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
      }
    };

    await db.collection('pages').updateOne(
      { id: pageId },
      { $set: { ...updateData, updated_at: now } }
    );
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

  return { saved, failed };
}

async function run() {
  const startTime = new Date();
  console.log(`\n=== Batch Processor Cron Job ===`);
  console.log(`Started: ${startTime.toISOString()}\n`);

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB);

  // Get all unsaved jobs with gemini_job_name
  const jobs = await db.collection('batch_jobs')
    .find({
      gemini_job_name: { $exists: true, $ne: null, $ne: '' },
      status: { $nin: ['saved', 'expired'] }
    })
    .toArray();

  console.log(`Found ${jobs.length} jobs to process\n`);

  for (const job of jobs) {
    try {
      const geminiData = await getBatchStatus(job.gemini_job_name);

      if (geminiData.expired) {
        // Mark as expired
        await db.collection('batch_jobs').updateOne(
          { id: job.id },
          { $set: { status: 'expired', gemini_state: 'EXPIRED', updated_at: new Date() } }
        );
        stats.expired++;
        process.stdout.write('x');
        continue;
      }

      // Update status
      const state = geminiData.state;
      const isSucceeded = state === 'BATCH_STATE_SUCCEEDED' || state === 'JOB_STATE_SUCCEEDED';

      await db.collection('batch_jobs').updateOne(
        { id: job.id },
        { $set: { gemini_state: state, updated_at: new Date() } }
      );
      stats.synced++;

      if (isSucceeded) {
        // Save results
        const { saved, failed } = await processJob(db, job, geminiData);
        stats.saved++;
        stats.pagesProcessed += saved;
        stats.failed += failed;
        process.stdout.write('.');
      } else {
        process.stdout.write('-');
      }

    } catch (e) {
      console.error(`\nError processing ${job.book_title}: ${e.message}`);
    }
  }

  await client.close();

  const duration = (Date.now() - startTime) / 1000;
  console.log(`\n\n=== Summary ===`);
  console.log(`Duration: ${duration.toFixed(1)}s`);
  console.log(`Jobs synced: ${stats.synced}`);
  console.log(`Jobs saved: ${stats.saved}`);
  console.log(`Jobs expired: ${stats.expired}`);
  console.log(`Pages processed: ${stats.pagesProcessed}`);
  console.log(`Pages failed: ${stats.failed}`);
  console.log(`\nCompleted: ${new Date().toISOString()}`);
}

run().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
