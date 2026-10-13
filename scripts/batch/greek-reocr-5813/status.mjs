#!/usr/bin/env node
// #5813 — where the job's Batch OCR jobs stand and what they cost: batch_jobs rows submitted by
// bulk-reocr-local.mjs with a #5813 reason, by status, with the COLLECTED tokens and cost_usd the
// collector writes on each job (the same figure it writes to Supabase gemini_usage). Read-only.
//   node --env-file=… scripts/batch/greek-reocr-5813/status.mjs [--reason=REGEX]
import { MongoClient } from 'mongodb';
const reason = new RegExp(process.argv.find((a) => a.startsWith('--reason='))?.slice(9) || '#5813');
const c = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2 });
await c.connect();
const J = c.db('bookstore').collection('batch_jobs');
const match = { submitted_by: 'scripts/batch/bulk-reocr-local.mjs', initiated_reason: reason, type: 'ocr' };
const rows = await J.aggregate([
  { $match: { ...match, parent_job_id: { $exists: true } } },
  { $group: { _id: '$status', jobs: { $sum: 1 }, pages: { $sum: '$page_count' }, saved: { $sum: { $ifNull: ['$completed_pages', 0] } }, failed: { $sum: { $ifNull: ['$failed_pages', 0] } }, usd: { $sum: { $ifNull: ['$cost_usd', 0] } }, in: { $sum: { $ifNull: ['$input_tokens', 0] } }, out: { $sum: { $ifNull: ['$output_tokens', 0] } } } },
]).toArray();
let t = { jobs: 0, pages: 0, saved: 0, failed: 0, usd: 0 };
for (const r of rows.sort((a, b) => b.pages - a.pages)) {
  console.log(`${String(r._id).padEnd(16)} jobs ${r.jobs}  pages ${r.pages}  saved ${r.saved}  failed ${r.failed}  $${r.usd.toFixed(2)}  in ${r.in} out ${r.out}`);
  for (const k of Object.keys(t)) t[k] += r[k];
}
console.log(`TOTAL            jobs ${t.jobs}  pages ${t.pages}  saved ${t.saved}  failed ${t.failed}  $${t.usd.toFixed(2)}`);
const why = await J.aggregate([{ $match: { ...match, fail_reasons: { $exists: true } } }, { $project: { r: { $objectToArray: '$fail_reasons' } } }, { $unwind: '$r' }, { $group: { _id: '$r.k', n: { $sum: '$r.v' } } }]).toArray();
console.log('page failures by reason', JSON.stringify(Object.fromEntries(why.map((w) => [w._id, w.n]))));
const sf = await J.aggregate([{ $match: { ...match, status: 'submit_failed' } }, { $group: { _id: '$failure_stage', n: { $sum: '$page_count' } } }]).toArray();
console.log('submit_failed pages by stage', JSON.stringify(Object.fromEntries(sf.map((w) => [w._id, w.n]))));
await c.close();
