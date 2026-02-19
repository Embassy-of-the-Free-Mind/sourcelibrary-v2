#!/usr/bin/env node
/**
 * Quick system status check — pipeline, jobs, recent activity.
 */
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI required'); process.exit(1); }

const client = new MongoClient(uri, { maxPoolSize: 1 });
const timeout = setTimeout(() => { console.error('Script timeout (60s)'); client.close(); process.exit(1); }, 60000);

try {
  await client.connect();
  const db = client.db('bookstore');

  // Pipeline status distribution
  const pipelineStats = await db.collection('books').aggregate([
    { $match: { 'pipeline_auto.status': { $exists: true } } },
    { $group: { _id: '$pipeline_auto.status', count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]).toArray();

  console.log('=== Pipeline Status ===');
  for (const s of pipelineStats) {
    console.log(`  ${s._id}: ${s.count}`);
  }

  // Active jobs (last 2 hours)
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const activeJobs = await db.collection('jobs').aggregate([
    { $match: { status: { $in: ['pending', 'processing'] } } },
    { $group: { _id: { type: '$type', status: '$status' }, count: { $sum: 1 }, pages: { $sum: '$progress.total' } } },
    { $sort: { '_id.type': 1 } }
  ]).toArray();

  console.log('\n=== Active Jobs ===');
  if (activeJobs.length === 0) {
    console.log('  None');
  } else {
    for (const j of activeJobs) {
      console.log(`  ${j._id.type} (${j._id.status}): ${j.count} jobs, ${j.pages} pages`);
    }
  }

  // Active batch jobs
  const activeBatch = await db.collection('batch_jobs').aggregate([
    { $match: { status: { $in: ['pending', 'processing'] } } },
    { $group: { _id: { type: '$type', status: '$status' }, count: { $sum: 1 }, pages: { $sum: '$total_pages' } } }
  ]).toArray();

  console.log('\n=== Active Batch Jobs ===');
  if (activeBatch.length === 0) {
    console.log('  None');
  } else {
    for (const b of activeBatch) {
      console.log(`  ${b._id.type} (${b._id.status}): ${b.count} jobs, ${b.pages} pages`);
    }
  }

  // Recent completions (last 6 hours)
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const recentCompletions = await db.collection('jobs').aggregate([
    { $match: { completed_at: { $gte: sixHoursAgo }, status: { $in: ['completed', 'completed_with_errors'] } } },
    { $group: { _id: '$type', jobs: { $sum: 1 }, completed: { $sum: '$progress.completed' }, failed: { $sum: '$progress.failed' } } }
  ]).toArray();

  console.log('\n=== Completed (last 6h) ===');
  if (recentCompletions.length === 0) {
    console.log('  None');
  } else {
    for (const r of recentCompletions) {
      console.log(`  ${r._id}: ${r.jobs} jobs, ${r.completed} pages OK, ${r.failed} failed`);
    }
  }

  // Recent batch completions
  const recentBatch = await db.collection('batch_jobs').aggregate([
    { $match: { completed_at: { $gte: sixHoursAgo }, status: { $in: ['completed', 'completed_with_errors'] } } },
    { $group: { _id: '$type', jobs: { $sum: 1 }, pages: { $sum: '$total_pages' } } }
  ]).toArray();

  if (recentBatch.length > 0) {
    console.log('  Batch:');
    for (const b of recentBatch) {
      console.log(`    ${b._id}: ${b.jobs} jobs, ${b.pages} pages`);
    }
  }

  // Emergency stop?
  const emergencyStop = await db.collection('system_config').findOne({ key: 'emergency_stop' });
  if (emergencyStop?.active) {
    console.log('\n⚠️  EMERGENCY STOP IS ACTIVE');
  }

  // Overall counts
  const totalBooks = await db.collection('books').countDocuments();
  const totalPages = await db.collection('pages').countDocuments();
  const pagesWithOcr = await db.collection('pages').countDocuments({ 'ocr.data': { $exists: true, $ne: null, $ne: '' } });
  const pagesWithTranslation = await db.collection('pages').countDocuments({ 'translation.data': { $exists: true, $ne: null, $ne: '' } });

  console.log('\n=== Overall ===');
  console.log(`  Books: ${totalBooks}`);
  console.log(`  Pages: ${totalPages}`);
  console.log(`  OCR'd: ${pagesWithOcr} (${(pagesWithOcr / totalPages * 100).toFixed(1)}%)`);
  console.log(`  Translated: ${pagesWithTranslation} (${(pagesWithTranslation / totalPages * 100).toFixed(1)}%)`);

  // Books needing attention
  const needsAttention = await db.collection('books').countDocuments({ 'pipeline_auto.status': 'needs_attention' });
  const failed = await db.collection('books').countDocuments({ 'pipeline_auto.status': 'failed' });
  if (needsAttention > 0 || failed > 0) {
    console.log(`\n⚠️  Needs attention: ${needsAttention}, Failed: ${failed}`);
  }

} finally {
  clearTimeout(timeout);
  await client.close();
}
