#!/usr/bin/env node
/**
 * Auto-cancel stuck jobs — jobs in 'processing' with 0 progress for >2 hours.
 * Clears the book.job lock so the pipeline can re-submit.
 *
 * Run via Hetzner cron every 30 minutes:
 *   */30 * * * * cd /root/sourcelibrary && set -a && source .env.production.local && set +a && node scripts/workers/auto-cancel-stuck-jobs.mjs >> /tmp/auto-cancel.log 2>&1
 */

import { MongoClient } from 'mongodb';

const STUCK_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

async function main() {
  const mongo = new MongoClient(process.env.MONGODB_URI);
  await mongo.connect();
  const db = mongo.db('bookstore');

  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);

  const stuckJobs = await db.collection('jobs').find({
    status: 'processing',
    'progress.completed': 0,
    created_at: { $lt: cutoff },
  }).toArray();

  if (stuckJobs.length === 0) {
    await mongo.close();
    return;
  }

  console.log(`[${new Date().toISOString()}] Found ${stuckJobs.length} stuck jobs:`);

  for (const job of stuckJobs) {
    const age = Math.round((Date.now() - new Date(job.created_at).getTime()) / 3600000);
    console.log(`  ${job.type} | ${job.book_title?.substring(0, 40)} | ${age}h old | progress: ${job.progress?.completed}/${job.progress?.total}`);

    await db.collection('jobs').updateOne(
      { _id: job._id },
      { $set: { status: 'cancelled', cancelled_at: new Date(), cancel_reason: `auto: stuck ${age}h with 0 progress` } }
    );

    if (job.book_id) {
      await db.collection('books').updateOne(
        { id: job.book_id },
        { $unset: { job: '' } }
      );
    }
  }

  console.log(`  Cancelled ${stuckJobs.length} jobs, cleared book locks`);
  await mongo.close();
}

main().catch(err => { console.error(err); process.exit(1); });
