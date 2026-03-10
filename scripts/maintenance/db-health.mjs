#!/usr/bin/env node
/**
 * Database health check script.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/db-health.mjs
 *
 * Checks: connectivity, query latency, search indexes, pipeline status, active jobs.
 * Exit code 0 = healthy, 1 = degraded, 2 = down.
 */

import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(2); }

const THRESHOLDS = {
  ping: 100,        // ms — anything over this is concerning
  findOne: 200,     // ms
  aggregation: 2000, // ms — pipeline status aggregation
  search: 3000,     // ms — Atlas Search query
};

const client = new MongoClient(uri, {
  serverSelectionTimeoutMS: 10000,
  connectTimeoutMS: 10000,
});

let degraded = false;

function status(label, ms, threshold) {
  const ok = ms <= threshold;
  if (!ok) degraded = true;
  const icon = ok ? '\x1b[32m✓\x1b[0m' : '\x1b[33m!\x1b[0m';
  const color = ok ? '' : '\x1b[33m';
  const reset = ok ? '' : '\x1b[0m';
  console.log(`  ${icon} ${label}: ${color}${ms}ms${reset}${ok ? '' : ` (threshold: ${threshold}ms)`}`);
  return ok;
}

async function timed(fn) {
  const t = Date.now();
  const result = await fn();
  return { result, ms: Date.now() - t };
}

async function main() {
  const t0 = Date.now();

  // 1. Connect
  try {
    await client.connect();
  } catch (e) {
    console.error('\x1b[31m✗ Cannot connect to MongoDB:\x1b[0m', e.message);
    process.exit(2);
  }

  const db = client.db('bookstore');
  console.log('\n\x1b[1mDatabase Health Check\x1b[0m\n');

  // 2. Latency
  console.log('\x1b[1mLatency\x1b[0m');
  const ping = await timed(() => db.command({ ping: 1 }));
  status('ping', ping.ms, THRESHOLDS.ping);

  const bookFind = await timed(() => db.collection('books').findOne({}, { projection: { id: 1 } }));
  status('books.findOne', bookFind.ms, THRESHOLDS.findOne);

  const pageFind = await timed(() => db.collection('pages').findOne({}, { projection: { id: 1 } }));
  status('pages.findOne', pageFind.ms, THRESHOLDS.findOne);

  // 3. Collection sizes
  console.log('\n\x1b[1mCollections\x1b[0m');
  const { result: bookCount, ms: bcMs } = await timed(() => db.collection('books').estimatedDocumentCount());
  console.log(`  books: ${bookCount.toLocaleString()} (${bcMs}ms)`);

  const { result: pageCount, ms: pcMs } = await timed(() => db.collection('pages').estimatedDocumentCount());
  console.log(`  pages: ${pageCount.toLocaleString()} (${pcMs}ms)`);

  // 4. Search indexes
  console.log('\n\x1b[1mAtlas Search Indexes\x1b[0m');
  try {
    const { result: booksIdx, ms: biMs } = await timed(() => db.collection('books').listSearchIndexes().toArray());
    const { result: pagesIdx } = await timed(() => db.collection('pages').listSearchIndexes().toArray());

    if (booksIdx.length === 0 && pagesIdx.length === 0) {
      console.log('  \x1b[33m! No search indexes found\x1b[0m');
      degraded = true;
    }
    for (const idx of booksIdx) {
      const ok = idx.status === 'READY';
      if (!ok) degraded = true;
      console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[33m!\x1b[0m'} books/${idx.name}: ${idx.status}`);
    }
    for (const idx of pagesIdx) {
      const ok = idx.status === 'READY';
      if (!ok) degraded = true;
      console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[33m!\x1b[0m'} pages/${idx.name}: ${idx.status}`);
    }
    if (pagesIdx.length === 0) {
      console.log('  \x1b[33m! pages_search: not created (page content search uses regex fallback)\x1b[0m');
    }
  } catch (e) {
    console.log('  \x1b[31m✗ Failed to list search indexes:\x1b[0m', e.message);
    degraded = true;
  }

  // 5. Atlas Search query test
  console.log('\n\x1b[1mAtlas Search Query\x1b[0m');
  try {
    const { result: searchResult, ms: searchMs } = await timed(() =>
      db.collection('books').aggregate([
        { $search: { index: 'books_search', compound: { should: [{ text: { query: 'alchemy', path: 'title' } }], minimumShouldMatch: 1, mustNot: [{ equals: { path: 'hidden', value: true } }] } } },
        { $limit: 3 },
        { $project: { title: 1, _id: 0 } }
      ], { maxTimeMS: 5000 }).toArray()
    );
    status('$search query', searchMs, THRESHOLDS.search);
    console.log(`    ${searchResult.length} results: ${searchResult.map(r => r.title.substring(0, 40)).join(', ')}`);
  } catch (e) {
    console.log('  \x1b[31m✗ Atlas Search query failed:\x1b[0m', e.message);
    degraded = true;
  }

  // 6. Pipeline status
  console.log('\n\x1b[1mPipeline\x1b[0m');
  try {
    const { result: pipeline, ms: plMs } = await timed(() =>
      db.collection('books').aggregate([
        { $match: { 'pipeline_auto.status': { $exists: true } } },
        { $group: { _id: '$pipeline_auto.status', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ], { maxTimeMS: 10000 }).toArray()
    );
    status('pipeline aggregation', plMs, THRESHOLDS.aggregation);
    const total = pipeline.reduce((s, p) => s + p.count, 0);
    const complete = pipeline.find(p => p._id === 'complete')?.count || 0;
    const failed = pipeline.find(p => p._id === 'failed')?.count || 0;
    const inFlight = total - complete - failed - (pipeline.find(p => p._id === 'empty_shell')?.count || 0);
    console.log(`    ${complete} complete, ${inFlight} in-flight, ${failed} failed (${total} total)`);
  } catch (e) {
    console.log('  \x1b[31m✗ Pipeline query failed:\x1b[0m', e.message);
    degraded = true;
  }

  // 7. Active jobs
  console.log('\n\x1b[1mActive Jobs\x1b[0m');
  try {
    const { result: jobs, ms: jMs } = await timed(() =>
      db.collection('jobs').aggregate([
        { $match: { status: { $in: ['pending', 'processing'] } } },
        { $group: { _id: '$type', count: { $sum: 1 } } }
      ], { maxTimeMS: 5000 }).toArray()
    );
    if (jobs.length === 0) {
      console.log('  none');
    } else {
      for (const j of jobs) console.log(`  ${j._id}: ${j.count}`);
    }
  } catch (e) {
    console.log('  \x1b[31m✗ Jobs query failed:\x1b[0m', e.message);
  }

  // 8. Recent cron health
  console.log('\n\x1b[1mRecent Crons (last 2h)\x1b[0m');
  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const { result: crons } = await timed(() =>
      db.collection('cron_runs').aggregate([
        { $match: { timestamp: { $gte: twoHoursAgo } } },
        { $group: { _id: '$cron', runs: { $sum: 1 }, failures: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } }, lastRun: { $max: '$timestamp' } } },
        { $sort: { lastRun: -1 } }
      ], { maxTimeMS: 5000 }).toArray()
    );
    if (crons.length === 0) {
      console.log('  \x1b[33m! No cron runs in last 2 hours\x1b[0m');
    } else {
      for (const c of crons) {
        const ago = Math.round((Date.now() - new Date(c.lastRun).getTime()) / 60000);
        const failNote = c.failures > 0 ? ` \x1b[33m(${c.failures} failed)\x1b[0m` : '';
        console.log(`  ${c._id}: ${c.runs} runs, last ${ago}m ago${failNote}`);
      }
    }
  } catch (e) {
    console.log('  \x1b[31m✗ Cron query failed:\x1b[0m', e.message);
  }

  // Summary
  const totalMs = Date.now() - t0;
  console.log(`\n\x1b[1mResult: ${degraded ? '\x1b[33mDEGRADED' : '\x1b[32mHEALTHY'}\x1b[0m (${totalMs}ms)\n`);

  await client.close();
  process.exit(degraded ? 1 : 0);
}

main().catch(e => {
  console.error('\x1b[31m✗ Fatal error:\x1b[0m', e.message);
  process.exit(2);
});
