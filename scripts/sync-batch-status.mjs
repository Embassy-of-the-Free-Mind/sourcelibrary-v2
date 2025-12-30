/**
 * Sync batch job statuses from Gemini and save completed results
 */
import { config } from 'dotenv';
import { MongoClient } from 'mongodb';
config({ path: '.env.local' });

const API_KEY = process.env.GEMINI_API_KEY;
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

async function getBatchStatus(jobName) {
  const res = await fetch(`${API_BASE}/${jobName}?key=${API_KEY}`);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to get status: ${err}`);
  }
  const data = await res.json();
  return {
    name: data.name,
    state: data.metadata?.state || 'UNKNOWN',
    stats: data.metadata?.batchStats || {},
    createTime: data.metadata?.createTime,
  };
}

async function syncStatuses() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB);

  console.log('=== Syncing Batch Job Statuses ===\n');

  // Get all jobs with gemini_job_name
  const jobs = await db.collection('batch_jobs')
    .find({ gemini_job_name: { $exists: true, $ne: null, $ne: '' } })
    .toArray();

  console.log(`Found ${jobs.length} jobs to sync\n`);

  const stats = {
    succeeded: 0,
    running: 0,
    pending: 0,
    failed: 0,
    cancelled: 0,
    unknown: 0,
    errors: 0,
  };

  // Check all jobs (not just a sample)
  const samplesToCheck = jobs;

  for (const job of samplesToCheck) {
    try {
      const geminiStatus = await getBatchStatus(job.gemini_job_name);

      // Update our DB
      let newStatus = job.status;
      if (geminiStatus.state === 'BATCH_STATE_RUNNING') {
        newStatus = 'processing';
        stats.running++;
      } else if (geminiStatus.state === 'BATCH_STATE_SUCCEEDED') {
        newStatus = 'completed';
        stats.succeeded++;
      } else if (geminiStatus.state === 'BATCH_STATE_FAILED') {
        newStatus = 'failed';
        stats.failed++;
      } else if (geminiStatus.state === 'BATCH_STATE_CANCELLED') {
        newStatus = 'cancelled';
        stats.cancelled++;
      } else if (geminiStatus.state === 'BATCH_STATE_PENDING') {
        stats.pending++;
      } else {
        stats.unknown++;
      }

      // Update if changed
      if (newStatus !== job.status || geminiStatus.state !== job.gemini_state) {
        await db.collection('batch_jobs').updateOne(
          { id: job.id },
          {
            $set: {
              status: newStatus,
              gemini_state: geminiStatus.state,
              gemini_stats: geminiStatus.stats,
              updated_at: new Date(),
            },
          }
        );
      }

      process.stdout.write('.');
    } catch (e) {
      stats.errors++;
      process.stdout.write('x');
    }
  }

  console.log('\n\nStatus breakdown (sampled):');
  console.log(`  Succeeded: ${stats.succeeded}`);
  console.log(`  Running: ${stats.running}`);
  console.log(`  Pending: ${stats.pending}`);
  console.log(`  Failed: ${stats.failed}`);
  console.log(`  Cancelled: ${stats.cancelled}`);
  console.log(`  Unknown: ${stats.unknown}`);
  console.log(`  Errors checking: ${stats.errors}`);

  if (stats.succeeded > 0) {
    console.log(`\n${stats.succeeded} jobs succeeded! Run save-batch-results.mjs to save them.`);
  }

  await client.close();
}

syncStatuses().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
