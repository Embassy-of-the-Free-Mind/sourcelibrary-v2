import { MongoClient } from 'mongodb';
const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
await client.connect();
const db = client.db('bookstore');

// Quick check — just list indexes, no creation
for (const col of ['gemini_usage', 'cron_runs', 'pipeline_snapshots', 'loading_metrics']) {
  try {
    const idxs = await db.collection(col).indexes();
    console.log(`${col} (${idxs.length} indexes):`);
    for (const idx of idxs) {
      console.log(`  ${idx.name}: ${JSON.stringify(idx.key)}`);
    }
  } catch (e) {
    console.log(`${col}: ERROR — ${e.message}`);
  }
}

await client.close();
