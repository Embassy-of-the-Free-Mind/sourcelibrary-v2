import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 900000,  // 15 min for large index builds
  connectTimeoutMS: 10000,
});
await client.connect();
const db = client.db('bookstore');

const allIndexes = [
  // Small collections first
  { collection: 'cron_runs', key: { timestamp: -1 }, name: 'cron_runs_ts_idx' },
  { collection: 'cron_runs', key: { cron: 1, timestamp: -1 }, name: 'cron_runs_cron_ts_idx' },
  { collection: 'cron_runs', key: { status: 1, timestamp: -1 }, name: 'cron_runs_status_ts_idx' },
  { collection: 'pipeline_snapshots', key: { timestamp: -1 }, name: 'pipeline_snapshots_ts_idx' },
  { collection: 'loading_metrics', key: { received_at: -1 }, name: 'loading_metrics_received_at_idx' },
  { collection: 'loading_metrics', key: { name: 1, received_at: -1 }, name: 'loading_metrics_name_ts_idx' },
  // Big collection last
  { collection: 'gemini_usage', key: { timestamp: -1 }, name: 'gemini_usage_ts_idx' },
  { collection: 'gemini_usage', key: { status: 1, timestamp: -1 }, name: 'gemini_usage_status_ts_idx' },
];

for (const idx of allIndexes) {
  const start = Date.now();
  process.stdout.write(`${idx.collection}.${idx.name} ... `);
  try {
    await db.collection(idx.collection).createIndex(idx.key, { name: idx.name });
    console.log(`OK (${((Date.now() - start) / 1000).toFixed(1)}s)`);
  } catch (e) {
    if (e.message?.includes('already exists') || e.code === 85) {
      console.log(`EXISTS (${((Date.now() - start) / 1000).toFixed(1)}s)`);
    } else {
      console.log(`ERROR: ${e.message} (${((Date.now() - start) / 1000).toFixed(1)}s)`);
    }
  }
}

await client.close();
console.log('\nDone.');
