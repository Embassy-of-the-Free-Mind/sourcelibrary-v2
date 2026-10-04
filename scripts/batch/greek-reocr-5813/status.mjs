#!/usr/bin/env node
// #5813 — where the job's Batch OCR jobs stand: batch_jobs rows by status, pages written, and the
// collected usage (actual tokens and $ from gemini_usage in Mongo, by batch_job_id).
//   node --env-file=… scripts/batch/greek-reocr-5813/status.mjs [--since=ISO]
import { MongoClient } from 'mongodb';
const since = new Date(process.argv.find((a) => a.startsWith('--since='))?.slice(8) || '2026-10-04T16:00:00Z');
const c = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2 });
await c.connect();
const db = c.db('bookstore');
const jobs = await db.collection('batch_jobs').find(
  { submitted_by: 'scripts/batch/bulk-reocr-local.mjs', created_at: { $gte: since }, initiated_reason: /#5813/, job_name: { $exists: true } },
  { projection: { _id: 0, id: 1, status: 1, page_count: 1, results: 1, error: 1, completed_pages: 1, failed_pages: 1, success_count: 1, fail_count: 1, input_tokens: 1, output_tokens: 1, cost_usd: 1 } },
).toArray();
const by = {};
for (const j of jobs) { (by[j.status] ??= { jobs: 0, pages: 0 }); by[j.status].jobs++; by[j.status].pages += j.page_count || 0; }
console.log('child jobs', jobs.length, JSON.stringify(by));
const failed = await db.collection('batch_jobs').countDocuments({ submitted_by: 'scripts/batch/bulk-reocr-local.mjs', created_at: { $gte: since }, initiated_reason: /#5813/, status: 'submit_failed' });
console.log('submit_failed rows', failed);
console.log('sample job', JSON.stringify(jobs.find((j) => !['pending'].includes(j.status)) || jobs[0]));
await c.close();
