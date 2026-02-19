/**
 * Fix stuck processing jobs.
 *
 * Jobs get stuck at `completed + failed = total - 1` when a page has
 * `ocr.data: ''` (blank page). The old completion check used
 * `$nin: [null, '']` which excluded blank pages, so the job never
 * reached the completion threshold.
 *
 * The fix has been deployed to the Vercel app (checkJobCompletion now
 * uses `$ne: null`) but NOT to the Lambda workers (no IAM permissions).
 * This script manually completes stuck jobs.
 *
 * Usage:
 *   secret-lover run -- node scripts/maintenance/fix-stuck-jobs.mjs [--dry-run]
 */

import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');
  const jobs = db.collection('jobs');
  const pages = db.collection('pages');
  const books = db.collection('books');

  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== LIVE RUN ===');
  console.log('');

  // Find all jobs stuck in "processing" state
  const stuckJobs = await jobs.find({
    status: 'processing'
  }).toArray();

  console.log(`Found ${stuckJobs.length} jobs with status "processing"\n`);

  if (stuckJobs.length === 0) {
    console.log('No stuck jobs found. Exiting.');
    await client.close();
    return;
  }

  let fixed = 0;
  let skipped = 0;

  for (const job of stuckJobs) {
    const targetPageIds = job.config?.page_ids || [];
    const bookId = job.book_id;
    const jobType = job.type || 'ocr';

    console.log(`--- Job ${job.id} ---`);
    console.log(`  Book: ${job.book_title || bookId}`);
    console.log(`  Type: ${jobType}`);
    console.log(`  Progress (stored): ${job.progress?.completed || 0} completed, ${job.progress?.failed || 0} failed, ${job.progress?.total || targetPageIds.length} total`);
    console.log(`  Target pages: ${targetPageIds.length}`);

    if (targetPageIds.length === 0) {
      console.log(`  SKIP: No target page IDs in config\n`);
      skipped++;
      continue;
    }

    // Count actually completed pages using the FIXED query ($ne: null instead of $nin: [null, ''])
    // This counts pages where ocr.data exists and is not null — including empty strings (blank pages)
    let completedField;
    let completedQuery;
    switch (jobType) {
      case 'translation':
        completedField = 'translation.data';
        completedQuery = { book_id: bookId, id: { $in: targetPageIds }, 'translation.data': { $exists: true, $ne: null } };
        break;
      case 'image_extraction':
        completedField = 'detected_images';
        completedQuery = { book_id: bookId, id: { $in: targetPageIds }, 'detected_images': { $exists: true, $ne: null } };
        break;
      default: // ocr
        completedField = 'ocr.data';
        completedQuery = { book_id: bookId, id: { $in: targetPageIds }, 'ocr.data': { $exists: true, $ne: null } };
    }

    const actualCompleted = await pages.countDocuments(completedQuery);
    const failedCount = job.progress?.failed || 0;
    const failedPageIds = job.failed_page_ids || [];
    const totalAttempted = actualCompleted + failedCount;

    console.log(`  Actual completed (using $ne: null): ${actualCompleted}`);
    console.log(`  Failed: ${failedCount} (${failedPageIds.length} page IDs)`);
    console.log(`  Total attempted: ${totalAttempted} / ${targetPageIds.length}`);

    // Also count with the OLD buggy query to show the discrepancy
    let buggyCompleted;
    if (jobType === 'ocr') {
      buggyCompleted = await pages.countDocuments({
        book_id: bookId,
        id: { $in: targetPageIds },
        'ocr.data': { $nin: [null, ''] }
      });
      if (buggyCompleted !== actualCompleted) {
        console.log(`  Old query ($nin [null,'']): ${buggyCompleted} — DISCREPANCY of ${actualCompleted - buggyCompleted} blank pages`);
      }
    }

    // Check if the job is actually done
    if (totalAttempted >= targetPageIds.length) {
      const finalStatus = failedCount > 0 ? 'completed_with_errors' : 'completed';
      console.log(`  => Job is DONE. Setting status to "${finalStatus}"`);

      if (!DRY_RUN) {
        // Update job status
        await jobs.updateOne(
          { _id: job._id },
          {
            $set: {
              status: finalStatus,
              'progress.completed': actualCompleted,
              completed_at: new Date(),
              updated_at: new Date()
            }
          }
        );

        // Update book: clear job reference, update pages_ocr
        if (jobType === 'ocr') {
          // Count total OCR pages for the whole book (not just this job's target pages)
          const totalPagesWithOcr = await pages.countDocuments({
            book_id: bookId,
            'ocr.data': { $exists: true, $ne: '' }
          });

          await books.updateOne(
            { id: bookId },
            {
              $set: {
                pages_ocr: totalPagesWithOcr,
                updated_at: new Date()
              },
              $unset: { job: '' }
            }
          );
          console.log(`  Updated book: pages_ocr = ${totalPagesWithOcr}, cleared job reference`);
        } else if (jobType === 'translation') {
          const totalPagesTranslated = await pages.countDocuments({
            book_id: bookId,
            'translation.data': { $exists: true, $ne: '' }
          });

          await books.updateOne(
            { id: bookId },
            {
              $set: {
                pages_translated: totalPagesTranslated,
                updated_at: new Date()
              },
              $unset: { job: '' }
            }
          );
          console.log(`  Updated book: pages_translated = ${totalPagesTranslated}, cleared job reference`);
        } else {
          // image_extraction — just clear job reference
          await books.updateOne(
            { id: bookId },
            {
              $set: { updated_at: new Date() },
              $unset: { job: '' }
            }
          );
          console.log(`  Cleared job reference from book`);
        }
      }

      fixed++;
    } else {
      const remaining = targetPageIds.length - totalAttempted;
      console.log(`  => NOT done yet. ${remaining} pages still unprocessed.`);

      // Show which pages haven't been processed
      if (remaining <= 10) {
        const processedPageIds = await pages.find(
          completedQuery,
          { projection: { id: 1 } }
        ).toArray().then(docs => new Set(docs.map(d => d.id)));

        const failedSet = new Set(failedPageIds);
        const unprocessed = targetPageIds.filter(id => !processedPageIds.has(id) && !failedSet.has(id));
        console.log(`  Unprocessed page IDs: ${unprocessed.join(', ')}`);
      }

      skipped++;
    }

    console.log('');
  }

  console.log('=== SUMMARY ===');
  console.log(`Processing jobs found: ${stuckJobs.length}`);
  console.log(`Fixed (completed): ${fixed}`);
  console.log(`Skipped (still in progress or no page IDs): ${skipped}`);
  if (DRY_RUN) console.log('(DRY RUN — no changes made)');

  await client.close();
}

run().catch(e => { console.error(e); process.exit(1); });
