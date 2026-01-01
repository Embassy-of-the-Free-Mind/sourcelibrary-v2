/**
 * Cleanup batch jobs:
 * - Orphan jobs (never submitted to Gemini)
 * - Expired jobs (submitted but results not saved within 2-day window)
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
  const savedJobs = allJobs.filter(j => j.status === 'saved');

  // After running sync-batch-status.mjs, expired jobs are marked with status='expired'
  const expiredJobs = allJobs.filter(j => j.status === 'expired' || j.gemini_state === 'EXPIRED');

  const activeJobs = allJobs.filter(j =>
    j.gemini_job_name &&
    j.status !== 'saved' &&
    j.status !== 'expired'
  );

  console.log(`\nBreakdown:`);
  console.log(`  - Saved (results in DB): ${savedJobs.length}`);
  console.log(`  - Active (< 2 days old): ${activeJobs.length}`);
  console.log(`  - Expired (> 2 days, not saved): ${expiredJobs.length}`);
  console.log(`  - Orphan (no gemini_job_name): ${orphanJobs.length}`);

  // Delete orphan jobs
  if (orphanJobs.length > 0) {
    console.log(`\nDeleting ${orphanJobs.length} orphan jobs...`);
    const result = await db.collection('batch_jobs').deleteMany({
      $or: [
        { gemini_job_name: null },
        { gemini_job_name: '' },
        { gemini_job_name: { $exists: false } }
      ]
    });
    console.log(`Deleted: ${result.deletedCount} orphan jobs`);
  }

  // Delete expired jobs
  if (expiredJobs.length > 0) {
    console.log(`\nDeleting ${expiredJobs.length} expired jobs...`);
    const expiredIds = expiredJobs.map(j => j._id);
    const result = await db.collection('batch_jobs').deleteMany({
      _id: { $in: expiredIds }
    });
    console.log(`Deleted: ${result.deletedCount} expired jobs`);

    // Show affected books
    const expiredBooks = [...new Set(expiredJobs.map(j => j.book_title))];
    console.log(`Affected ${expiredBooks.length} unique books (will need re-OCR)`);
  }

  // Also clean up the 'jobs' collection (the old job queue)
  const queuedJobs = await db.collection('jobs').find({
    type: { $in: ['batch_ocr', 'batch_translate'] },
    status: 'pending'
  }).toArray();

  if (queuedJobs.length > 0) {
    console.log(`\nFound ${queuedJobs.length} pending jobs in 'jobs' collection`);
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
