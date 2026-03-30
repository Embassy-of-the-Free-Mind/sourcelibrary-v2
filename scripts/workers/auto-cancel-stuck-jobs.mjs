#!/usr/bin/env node
/**
 * Auto-cancel stuck jobs + site health check.
 * - Cancels any job in 'processing' that hasn't been updated in 2+ hours.
 * - Pings the browse API to detect DB saturation early.
 * - Clears the book.job lock so the pipeline can re-submit.
 *
 * Run via Hetzner cron every 30 minutes:
 *   */30 * * * * cd /root/sourcelibrary && set -a && source .env.production.local && set +a && node scripts/workers/auto-cancel-stuck-jobs.mjs >> /tmp/auto-cancel.log 2>&1
 */

import { MongoClient } from 'mongodb';

const STUCK_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours no update = stuck

async function main() {
  const mongo = new MongoClient(process.env.MONGODB_URI);
  await mongo.connect();
  const db = mongo.db('bookstore');

  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);

  // Any processing job not updated in 2h is stuck — regardless of progress
  const stuckJobs = await db.collection('jobs').find({
    status: 'processing',
    $or: [
      { updated_at: { $lt: cutoff } },
      { updated_at: { $exists: false }, created_at: { $lt: cutoff } },
    ],
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
      { $set: { status: 'cancelled', cancelled_at: new Date(), cancel_reason: `auto: stuck ${age}h, no update since ${job.updated_at?.toISOString?.() || 'unknown'}` } }
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

async function healthCheck() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch('https://sourcelibrary.org/api/books/library?limit=1', {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      console.error(`[${new Date().toISOString()}] HEALTH CHECK FAILED: browse API returned ${res.status}`);
    }
  } catch (err) {
    clearTimeout(timeout);
    console.error(`[${new Date().toISOString()}] HEALTH CHECK FAILED: browse API unreachable — ${err.message}`);
  }
}

Promise.all([main(), healthCheck()]).catch(err => { console.error(err); process.exit(1); });
