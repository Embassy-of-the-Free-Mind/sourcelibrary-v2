#!/usr/bin/env node
// Test crop job speed on Vercel deployment
// Usage: node scripts/test-crop-vercel.mjs [jobId]

const BASE_URL = 'https://sourcelibrary-v2.vercel.app';

async function processAndTime(jobId) {
  console.log(`\n=== Processing job ${jobId} ===`);

  // Get current job status
  const statusRes = await fetch(`${BASE_URL}/api/jobs/${jobId}`);
  const job = await statusRes.json();

  console.log(`Job type: ${job.type}`);
  console.log(`Status: ${job.status}`);
  console.log(`Progress: ${job.progress?.completed || 0}/${job.progress?.total || 0}`);

  if (job.status === 'completed') {
    console.log('Job already completed!');
    return;
  }

  const remaining = (job.progress?.total || 0) - (job.progress?.completed || 0) - (job.progress?.failed || 0);
  console.log(`Remaining: ${remaining} pages`);

  // Process one chunk and time it
  console.log('\nProcessing next chunk...');
  const start = Date.now();

  const processRes = await fetch(`${BASE_URL}/api/jobs/${jobId}/process`, {
    method: 'POST',
  });

  const result = await processRes.json();
  const duration = Date.now() - start;

  console.log(`\n--- Results ---`);
  console.log(`Processed: ${result.processed} pages`);
  console.log(`Duration: ${(duration / 1000).toFixed(2)}s`);
  console.log(`Speed: ${(duration / result.processed).toFixed(0)}ms per page`);
  console.log(`Remaining: ${result.remaining} pages`);

  if (result.remaining > 0) {
    const estimatedTime = (result.remaining / result.processed) * duration;
    console.log(`Estimated time for remaining: ${(estimatedTime / 1000).toFixed(1)}s`);
  }

  return result;
}

async function findCropJob() {
  console.log('Looking for existing crop jobs...\n');

  const jobsRes = await fetch(`${BASE_URL}/api/jobs`);
  const data = await jobsRes.json();
  const jobs = data.jobs || data;

  const cropJobs = jobs.filter(j => j.type === 'generate_cropped_images');

  for (const job of cropJobs.slice(0, 5)) {
    const remaining = job.progress.total - job.progress.completed - job.progress.failed;
    console.log(`Job ${job.id}: ${job.status} - ${job.progress.completed}/${job.progress.total} (${remaining} remaining)`);
  }

  // Find one that's not completed
  const activeJob = cropJobs.find(j => j.status !== 'completed' && j.status !== 'failed');
  return activeJob;
}

async function main() {
  const jobId = process.argv[2];

  if (jobId) {
    await processAndTime(jobId);
  } else {
    const job = await findCropJob();
    if (job) {
      await processAndTime(job.id);
    } else {
      console.log('\nNo active crop jobs found.');
      console.log('Usage: node scripts/test-crop-vercel.mjs <jobId>');
    }
  }
}

main().catch(console.error);
