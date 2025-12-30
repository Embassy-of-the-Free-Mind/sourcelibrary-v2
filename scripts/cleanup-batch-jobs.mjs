/**
 * Cleanup orphan batch jobs that were never submitted to Gemini
 */
import { config } from 'dotenv';
import { MongoClient } from 'mongodb';
config({ path: '.env.local' });

async function cleanup() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB);

  console.log('=== Batch Jobs Cleanup ===\n');

  // Get all batch_jobs
  const allJobs = await db.collection('batch_jobs').find({}).toArray();
  console.log(`Total batch_jobs: ${allJobs.length}`);

  // Categorize jobs
  const orphanJobs = allJobs.filter(j => !j.gemini_job_name);
  const pendingWithGemini = allJobs.filter(j => j.gemini_job_name && j.status === 'pending');
  const succeeded = allJobs.filter(j => j.gemini_state === 'JOB_STATE_SUCCEEDED' || j.status === 'saved');
  const running = allJobs.filter(j => j.gemini_state === 'JOB_STATE_RUNNING' || j.gemini_state === 'JOB_STATE_PENDING');

  console.log(`\nBreakdown:`);
  console.log(`  - Orphan (no gemini_job_name): ${orphanJobs.length}`);
  console.log(`  - Pending with Gemini job: ${pendingWithGemini.length}`);
  console.log(`  - Succeeded/Saved: ${succeeded.length}`);
  console.log(`  - Running/Pending at Gemini: ${running.length}`);

  // Show orphan books
  const orphanBooks = [...new Set(orphanJobs.map(j => j.book_title))];
  console.log(`\nOrphan jobs span ${orphanBooks.length} unique books`);

  // Delete orphan jobs
  if (orphanJobs.length > 0) {
    console.log(`\nDeleting ${orphanJobs.length} orphan jobs...`);
    const result = await db.collection('batch_jobs').deleteMany({
      gemini_job_name: { $in: [null, ''] }
    });
    console.log(`Deleted: ${result.deletedCount} jobs`);
  }

  // Also clean up the 'jobs' collection (the old job queue)
  const queuedJobs = await db.collection('jobs').find({
    type: { $in: ['batch_ocr', 'batch_translate'] },
    status: 'pending'
  }).toArray();

  if (queuedJobs.length > 0) {
    console.log(`\nFound ${queuedJobs.length} pending jobs in 'jobs' collection`);
    // Don't delete these - they might be needed
  }

  console.log('\n=== Cleanup Complete ===');

  // Show remaining
  const remaining = await db.collection('batch_jobs').countDocuments({});
  console.log(`Remaining batch_jobs: ${remaining}`);

  await client.close();
}

cleanup().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
