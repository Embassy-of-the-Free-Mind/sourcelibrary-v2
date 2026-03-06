import { MongoClient } from 'mongodb';

async function cleanup() {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  const stuckJobs = await db.collection('jobs').find({
    type: 'translation',
    status: 'processing'
  }).toArray();

  console.log('Stuck processing translation jobs:', stuckJobs.length);

  let fixed = 0, withErrors = 0, genuinelyStuck = 0;

  for (const job of stuckJobs) {
    const pageIds = job.config?.page_ids || [];
    if (pageIds.length === 0) {
      genuinelyStuck++;
      continue;
    }

    const translated = await db.collection('pages').countDocuments({
      id: { $in: pageIds },
      'translation.data': { $exists: true, $ne: '' }
    });

    const total = job.progress?.total || pageIds.length;
    const failed = total - translated;

    let newStatus;
    if (translated >= total) {
      newStatus = 'completed';
    } else if (translated > 0) {
      newStatus = 'completed_with_errors';
    } else {
      newStatus = 'failed';
    }

    let failedPageIds = [];
    if (failed > 0) {
      const translatedPages = await db.collection('pages').find(
        { id: { $in: pageIds }, 'translation.data': { $exists: true, $ne: '' } },
        { projection: { id: 1 } }
      ).toArray();
      const translatedSet = new Set(translatedPages.map(p => p.id));
      failedPageIds = pageIds.filter(id => !translatedSet.has(id));
    }

    await db.collection('jobs').updateOne(
      { _id: job._id },
      { $set: {
        status: newStatus,
        'progress.completed': translated,
        'progress.failed': failed,
        failed_page_ids: failedPageIds,
        completed_at: new Date(),
        updated_at: new Date(),
        _cleanup_note: 'Reconciled by cleanup script — job was stuck in processing'
      }}
    );

    // Clear book.job if it still points to this job
    if (job.book_id) {
      await db.collection('books').updateOne(
        { id: job.book_id, 'job.job_id': job.id || job._id.toString() },
        { $unset: { job: '' }, $set: { updated_at: new Date() } }
      );
    }

    if (newStatus === 'completed') fixed++;
    else if (newStatus === 'completed_with_errors') withErrors++;
    else genuinelyStuck++;

    if (failed > 0) {
      console.log(`  ${newStatus}: ${(job.book_title || '').slice(0,45)} | ${translated}/${total} translated, ${failed} missing`);
    }
  }

  console.log('\n=== Summary ===');
  console.log('Completed (all pages done):', fixed);
  console.log('Completed with errors (partial):', withErrors);
  console.log('Failed (0 translated):', genuinelyStuck);
  console.log('Total reconciled:', stuckJobs.length);

  // Fix stale pending jobs too
  const pendingJobs = await db.collection('jobs').find({
    type: 'translation',
    status: 'pending',
    created_at: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
  }).toArray();

  if (pendingJobs.length > 0) {
    console.log('\n=== Stale pending jobs:', pendingJobs.length, '===');
    for (const job of pendingJobs) {
      const pageIds = job.config?.page_ids || [];
      const translated = pageIds.length > 0 ? await db.collection('pages').countDocuments({
        id: { $in: pageIds },
        'translation.data': { $exists: true, $ne: '' }
      }) : 0;
      const total = job.progress?.total || pageIds.length;
      const newStatus = translated >= total ? 'completed' : translated > 0 ? 'completed_with_errors' : 'cancelled';
      await db.collection('jobs').updateOne(
        { _id: job._id },
        { $set: { status: newStatus, 'progress.completed': translated, completed_at: new Date(), updated_at: new Date(), _cleanup_note: 'Stale pending job reconciled' } }
      );
      console.log(`  ${newStatus}: ${(job.book_title || '').slice(0,45)} | ${translated}/${total}`);
    }
  }

  await client.close();
}

cleanup().catch(e => { console.error(e); process.exit(1); });
