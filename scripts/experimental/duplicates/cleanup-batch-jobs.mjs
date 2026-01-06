/**
 * Cleanup batch jobs:
 * - Orphan jobs (never submitted to Gemini)
 * - Expired jobs (submitted but results not saved within 2-day window)
 *
 * All deletions are logged to:
 * - logs/batch-cleanup.log (file)
 * - batch_jobs_archive collection (MongoDB)
 */
import { config } from 'dotenv';
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
config({ path: '.env.local' });

const LOG_DIR = 'logs';
const LOG_FILE = path.join(LOG_DIR, 'batch-cleanup.log');

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function log(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

async function cleanup() {
  ensureLogDir();

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB);

  log('=== Batch Jobs Cleanup Started ===');

  // Get all batch_jobs
  const allJobs = await db.collection('batch_jobs').find({}).toArray();
  log(`Total batch_jobs in database: ${allJobs.length}`);

  // Categorize jobs
  const orphanJobs = allJobs.filter(j => !j.gemini_job_name);
  const savedJobs = allJobs.filter(j => j.status === 'saved');
  const expiredJobs = allJobs.filter(j => j.status === 'expired' || j.gemini_state === 'EXPIRED');
  const activeJobs = allJobs.filter(j =>
    j.gemini_job_name &&
    j.status !== 'saved' &&
    j.status !== 'expired'
  );

  log(`Breakdown:`);
  log(`  - Saved (results in DB): ${savedJobs.length}`);
  log(`  - Active (< 2 days old): ${activeJobs.length}`);
  log(`  - Expired (> 2 days, not saved): ${expiredJobs.length}`);
  log(`  - Orphan (no gemini_job_name): ${orphanJobs.length}`);

  const archiveCollection = db.collection('batch_jobs_archive');
  const now = new Date();

  // Archive and delete orphan jobs
  if (orphanJobs.length > 0) {
    log(`Archiving and deleting ${orphanJobs.length} orphan jobs...`);

    // Archive each job with deletion metadata
    const archiveRecords = orphanJobs.map(job => ({
      ...job,
      _original_id: job._id,
      deleted_at: now,
      deletion_reason: 'orphan',
      deletion_note: 'Job never submitted to Gemini (no gemini_job_name)'
    }));
    delete archiveRecords.forEach(r => delete r._id);

    await archiveCollection.insertMany(archiveRecords);

    const result = await db.collection('batch_jobs').deleteMany({
      $or: [
        { gemini_job_name: null },
        { gemini_job_name: '' },
        { gemini_job_name: { $exists: false } }
      ]
    });
    log(`Archived and deleted: ${result.deletedCount} orphan jobs`);
  }

  // Archive and delete expired jobs
  if (expiredJobs.length > 0) {
    log(`Archiving and deleting ${expiredJobs.length} expired jobs...`);

    // Group by book for logging
    const bookPages = {};
    for (const job of expiredJobs) {
      if (!bookPages[job.book_title]) {
        bookPages[job.book_title] = { pages: 0, jobs: 0 };
      }
      bookPages[job.book_title].pages += job.total_pages || 0;
      bookPages[job.book_title].jobs += 1;
    }

    // Log each affected book
    log(`EXPIRED JOBS BY BOOK (OCR/translation results lost):`);
    for (const [title, data] of Object.entries(bookPages)) {
      log(`  - "${title}": ${data.pages} pages (${data.jobs} jobs)`);
    }

    // Archive each job with deletion metadata
    const archiveRecords = expiredJobs.map(job => ({
      ...job,
      _original_id: job._id,
      deleted_at: now,
      deletion_reason: 'expired',
      deletion_note: 'Results expired at Gemini (48h window passed without saving)'
    }));
    archiveRecords.forEach(r => delete r._id);

    await archiveCollection.insertMany(archiveRecords);

    const expiredIds = expiredJobs.map(j => j._id);
    const result = await db.collection('batch_jobs').deleteMany({
      _id: { $in: expiredIds }
    });
    log(`Archived and deleted: ${result.deletedCount} expired jobs`);

    const expiredBooks = [...new Set(expiredJobs.map(j => j.book_title))];
    const totalLostPages = Object.values(bookPages).reduce((sum, b) => sum + b.pages, 0);
    log(`TOTAL LOST: ${totalLostPages} pages across ${expiredBooks.length} books (will need re-OCR)`);
  }

  // Check old jobs collection
  const queuedJobs = await db.collection('jobs').find({
    type: { $in: ['batch_ocr', 'batch_translate'] },
    status: 'pending'
  }).toArray();

  if (queuedJobs.length > 0) {
    log(`Found ${queuedJobs.length} pending jobs in legacy 'jobs' collection`);
  }

  log('=== Cleanup Complete ===');

  // Show remaining
  const remaining = await db.collection('batch_jobs').countDocuments({});
  log(`Remaining active batch_jobs: ${remaining}`);

  // Show archive stats
  const archiveCount = await archiveCollection.countDocuments({});
  log(`Total archived batch_jobs: ${archiveCount}`);

  await client.close();
}

cleanup().catch(e => {
  log(`ERROR: ${e.message}`);
  console.error('Error:', e);
  process.exit(1);
});
