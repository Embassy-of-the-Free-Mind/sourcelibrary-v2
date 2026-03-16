import { MongoClient } from 'mongodb';
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

// Check current index builds
try {
  const ops = await db.admin().command({ currentOp: true, $all: true });
  const indexBuilds = ops.inprog?.filter(op => op.command?.createIndexes) || [];
  console.log(`Active index builds: ${indexBuilds.length}`);
  for (const op of indexBuilds) {
    console.log(`  ${op.command?.createIndexes} — ${op.msg || 'building'}`);
  }
} catch(e) {
  console.log('Cannot check currentOp (expected on Atlas shared tier):', e.message?.substring(0, 80));
}

// Check what indexes exist now
for (const col of ['gemini_usage', 'cron_runs', 'pipeline_snapshots', 'loading_metrics']) {
  const idxs = await db.collection(col).indexes();
  console.log(`\n${col} (${idxs.length} indexes):`);
  for (const idx of idxs) {
    console.log(`  ${idx.name}: ${JSON.stringify(idx.key)}`);
  }
}

await client.close();
