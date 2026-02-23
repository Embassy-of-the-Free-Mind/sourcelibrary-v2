import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

// 1. Cron runs
const runs = await db.collection('cron_runs')
  .find({ timestamp: { $gte: cutoff24h } })
  .sort({ timestamp: -1 })
  .toArray();

console.log('=== CRON RUNS (last 24h) ===');
console.log('Total runs:', runs.length);

const byCron = {};
for (const r of runs) {
  const name = r.cron || 'unknown';
  if (!byCron[name]) byCron[name] = [];
  byCron[name].push(r);
}

for (const [name, cronRuns] of Object.entries(byCron)) {
  const failures = cronRuns.filter(r => r.failed).length;
  const durations = cronRuns.map(r => r.duration_ms);
  const avg = Math.round(durations.reduce((a,b) => a+b, 0) / durations.length);
  console.log(`\n--- ${name} ---`);
  console.log(`  Runs: ${cronRuns.length}, Failures: ${failures}, Avg duration: ${avg}ms`);

  const latest = cronRuns[0];
  console.log(`  Latest: ${latest.timestamp.toISOString()} (${latest.status}) ${latest.duration_ms}ms`);
  if (latest.summary) console.log(`  Summary: ${latest.summary}`);
  if (latest.errors?.length) console.log(`  Errors: ${JSON.stringify(latest.errors.slice(0,3))}`);
  if (latest.decisions?.length) {
    const byType = {};
    for (const d of latest.decisions) byType[d.type] = (byType[d.type]||0) + 1;
    console.log(`  Decisions: ${JSON.stringify(byType)}`);
  }
  if (latest.actions && Object.keys(latest.actions).length > 0) {
    console.log(`  Actions: ${JSON.stringify(latest.actions)}`);
  }
}

// 2. Pipeline status
const pipeline = await db.collection('books').aggregate([
  { $group: { _id: '$pipeline_auto.status', count: { $sum: 1 } } },
  { $sort: { count: -1 } }
]).toArray();

console.log('\n\n=== PIPELINE STATUS ===');
for (const s of pipeline) {
  console.log(`  ${s._id || 'not_enrolled'}: ${s.count}`);
}

// 3. Gemini usage
const usage = await db.collection('gemini_usage').aggregate([
  { $match: { timestamp: { $gte: cutoff24h } } },
  { $group: {
    _id: { type: '$type', status: '$status' },
    count: { $sum: 1 },
    totalCost: { $sum: '$estimated_cost' },
    totalInput: { $sum: '$input_tokens' },
    totalOutput: { $sum: '$output_tokens' },
  }},
  { $sort: { count: -1 } }
]).toArray();

console.log('\n=== GEMINI USAGE (last 24h) ===');
let totalCost = 0;
for (const u of usage) {
  totalCost += u.totalCost || 0;
  console.log(`  ${u._id.type} [${u._id.status}]: ${u.count} calls, $${(u.totalCost||0).toFixed(4)}, ${u.totalInput||0} in / ${u.totalOutput||0} out tokens`);
}
console.log(`  TOTAL COST: $${totalCost.toFixed(4)}`);

// 4. Recent batch jobs
const batches = await db.collection('batch_jobs')
  .find({ created_at: { $gte: cutoff24h } })
  .sort({ created_at: -1 })
  .limit(10)
  .project({ type: 1, status: 1, book_title: 1, total_pages: 1, created_at: 1, progress: 1 })
  .toArray();

console.log('\n=== RECENT BATCH JOBS (last 24h) ===');
for (const b of batches) {
  console.log(`  ${b.type} [${b.status}] ${b.book_title?.substring(0,50)} - ${b.total_pages || '?'} pages`);
}
if (batches.length === 0) console.log('  (none)');

// 5. Snapshot count
const snapCount = await db.collection('pipeline_snapshots').countDocuments({ timestamp: { $gte: cutoff24h }});
console.log(`\n=== PIPELINE SNAPSHOTS: ${snapCount} in last 24h ===`);

// 6. Books completed recently
const recentComplete = await db.collection('books')
  .find({ 'pipeline_auto.status': 'complete', 'pipeline_auto.completed_at': { $gte: cutoff24h } })
  .project({ title: 1, 'pipeline_auto.completed_at': 1, pages_count: 1 })
  .sort({ 'pipeline_auto.completed_at': -1 })
  .limit(10)
  .toArray();

console.log('\n=== BOOKS COMPLETED (last 24h) ===');
for (const b of recentComplete) {
  console.log(`  ${b.title?.substring(0,60)} (${b.pages_count} pages) at ${b.pipeline_auto?.completed_at?.toISOString()}`);
}
if (recentComplete.length === 0) console.log('  (none)');

await client.close();
