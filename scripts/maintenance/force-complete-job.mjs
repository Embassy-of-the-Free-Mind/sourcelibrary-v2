#!/usr/bin/env node
/**
 * Force-complete a stuck job where some SQS messages were lost.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/force-complete-job.mjs --job-id=Z3_KgofIFr2-
 *
 * What it does:
 *   1. Reads the job record and checks progress
 *   2. Marks job as completed_with_errors (since some pages were missed)
 *   3. Records the missed page IDs in failed_page_ids
 *   4. Clears book.job so pipeline can advance
 */
import { withMongo } from '../lib/mongo.mjs';

const args = process.argv.slice(2);
const jobId = args.find(a => a.startsWith('--job-id='))?.split('=')[1];
const dryRun = args.includes('--dry-run');

if (!jobId) {
  console.error('Usage: node scripts/maintenance/force-complete-job.mjs --job-id=XXX [--dry-run]');
  process.exit(1);
}

await withMongo(async (db) => {
  const job = await db.collection('jobs').findOne({ id: jobId });
  if (!job) {
    console.error(`Job ${jobId} not found`);
    process.exit(1);
  }

  console.log(`Job: ${job.id}`);
  console.log(`  Type: ${job.type}`);
  console.log(`  Status: ${job.status}`);
  console.log(`  Book: ${job.book_id} (${job.book_title})`);
  console.log(`  Progress: ${job.progress?.completed || 0}/${job.progress?.total || 0} completed, ${job.progress?.failed || 0} failed`);

  const configPageIds = job.config?.page_ids || [];
  const completedCount = (job.progress?.completed || 0) + (job.progress?.failed || 0);
  const totalCount = job.progress?.total || configPageIds.length;
  const missing = totalCount - completedCount;

  console.log(`  Missing: ${missing} pages (SQS messages lost)`);

  if (job.status === 'completed' || job.status === 'completed_with_errors') {
    console.log('Job already completed. Nothing to do.');
    return;
  }

  // Find which pages were actually processed
  const processedField = job.type === 'ocr' ? 'ocr.data'
    : job.type === 'translation' ? 'translation.data'
    : job.type === 'image_extraction' ? 'detected_images'
    : null;

  let failedPageIds = job.failed_page_ids || [];

  if (processedField && configPageIds.length > 0) {
    // Find pages from the job that DON'T have results yet
    const pagesWithResults = await db.collection('pages')
      .find({
        id: { $in: configPageIds },
        [processedField]: { $exists: true, $ne: null },
      })
      .project({ id: 1 })
      .toArray();

    const processedIds = new Set(pagesWithResults.map(p => p.id));
    const missedIds = configPageIds.filter(id => !processedIds.has(id));
    failedPageIds = [...new Set([...failedPageIds, ...missedIds])];

    console.log(`  Pages with results: ${processedIds.size}`);
    console.log(`  Missed page IDs: ${missedIds.join(', ') || 'none'}`);
  }

  if (dryRun) {
    console.log('\n[DRY RUN] Would force-complete this job.');
    return;
  }

  // Force-complete the job
  const newStatus = failedPageIds.length > 0 ? 'completed_with_errors' : 'completed';
  await db.collection('jobs').updateOne(
    { id: jobId },
    {
      $set: {
        status: newStatus,
        completed_at: new Date(),
        updated_at: new Date(),
        failed_page_ids: failedPageIds,
        'progress.failed': failedPageIds.length,
        force_completed: true,
        force_completed_reason: `${missing} SQS messages lost — force-completed`,
      },
    },
  );

  console.log(`\nJob ${jobId} → ${newStatus}`);

  // Clear book.job so pipeline can advance
  const bookUpdate = await db.collection('books').updateOne(
    { id: job.book_id, 'job.job_id': jobId },
    { $unset: { job: '' } },
  );
  console.log(`Cleared book.job: ${bookUpdate.modifiedCount > 0 ? 'yes' : 'no (already clear or different job)'}`);

  console.log('Done. Pipeline cron will advance this book on next run.');
});
