import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 120000,
  socketTimeoutMS: 600000,  // 10 min socket timeout for long index builds
});
await client.connect();
const db = client.db('bookstore');

console.log('Creating indexes on small collections first...\n');

// Small collections first (fast)
const smallIndexes = [
  { collection: 'cron_runs', key: { timestamp: -1 }, name: 'cron_runs_ts_idx' },
  { collection: 'cron_runs', key: { cron: 1, timestamp: -1 }, name: 'cron_runs_cron_ts_idx' },
  { collection: 'cron_runs', key: { status: 1, timestamp: -1 }, name: 'cron_runs_status_ts_idx' },
  { collection: 'pipeline_snapshots', key: { timestamp: -1 }, name: 'pipeline_snapshots_ts_idx' },
  { collection: 'loading_metrics', key: { received_at: -1 }, name: 'loading_metrics_received_at_idx' },
  { collection: 'loading_metrics', key: { name: 1, received_at: -1 }, name: 'loading_metrics_name_ts_idx' },
];

for (const idx of smallIndexes) {
  try {
    await db.collection(idx.collection).createIndex(idx.key, { name: idx.name, background: true });
    console.log(`  OK: ${idx.collection}.${idx.name}`);
  } catch (e) {
    if (e.message?.includes('already exists')) {
      console.log(`  EXISTS: ${idx.collection}.${idx.name}`);
    } else {
      console.log(`  ERROR: ${idx.collection}.${idx.name} — ${e.message}`);
    }
  }
}

console.log('\nSmall collections done. Now creating gemini_usage indexes (1.4M docs, may take 10-30 min)...');
console.log(`  Started at: ${new Date().toLocaleTimeString()}`);

// Progress heartbeat
const heartbeat = setInterval(() => {
  console.log(`  ... still building (${new Date().toLocaleTimeString()})`);
}, 60000);

try {
  console.log('\n  Creating gemini_usage_ts_idx { timestamp: -1 } ...');
  await db.collection('gemini_usage').createIndex(
    { timestamp: -1 },
    { name: 'gemini_usage_ts_idx', background: true }
  );
  console.log('  OK: gemini_usage.gemini_usage_ts_idx');
} catch (e) {
  if (e.message?.includes('already exists')) {
    console.log('  EXISTS: gemini_usage.gemini_usage_ts_idx');
  } else {
    console.log(`  ERROR: gemini_usage.gemini_usage_ts_idx — ${e.message}`);
  }
}

try {
  console.log('\n  Creating gemini_usage_status_ts_idx { status: 1, timestamp: -1 } ...');
  await db.collection('gemini_usage').createIndex(
    { status: 1, timestamp: -1 },
    { name: 'gemini_usage_status_ts_idx', background: true }
  );
  console.log('  OK: gemini_usage.gemini_usage_status_ts_idx');
} catch (e) {
  if (e.message?.includes('already exists')) {
    console.log('  EXISTS: gemini_usage.gemini_usage_status_ts_idx');
  } else {
    console.log(`  ERROR: gemini_usage.gemini_usage_status_ts_idx — ${e.message}`);
  }
}

clearInterval(heartbeat);

console.log('\nDone. Final index state:\n');
for (const col of ['gemini_usage', 'cron_runs', 'pipeline_snapshots', 'loading_metrics']) {
  const idxs = await db.collection(col).indexes();
  console.log(`${col} (${idxs.length} indexes):`);
  for (const idx of idxs) {
    console.log(`  ${idx.name}: ${JSON.stringify(idx.key)}`);
  }
  console.log('');
}

await client.close();
