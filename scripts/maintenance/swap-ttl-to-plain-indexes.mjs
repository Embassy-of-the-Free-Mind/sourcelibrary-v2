#!/usr/bin/env node
/**
 * swap-ttl-to-plain-indexes.mjs — one-time post-deploy swap for #2976.
 *
 * Per the #2976 decision (Derek, 2026-07-05): remove ALL automated data
 * retention. This script drops the three live 90d TTL indexes and recreates
 * the same keys as PLAIN indexes (query support preserved, no expiry):
 *
 *   api_usage.ts_1                     { ts: 1 }        -> plain ts_1
 *   gemini_usage.gemini_usage_ttl_90d  { timestamp: 1 } -> plain timestamp_1
 *   analytics_events.ttl_90d_created_at { created_at: 1 } -> plain created_at_1
 *
 * ORDERING — run this AFTER the PR's code is deployed to prod. The old app
 * code lazily re-creates the api_usage TTL on cold start; swapping before
 * deploy would be undone within minutes. (The new code creates plain indexes
 * and tolerates the interim conflict with the legacy TTL — error code 85.)
 *
 * Drop-then-create: MongoDB refuses two indexes on the same key pattern, so
 * the plain replacement cannot be built under a temp name first. The brief
 * gap (seconds; foreground build on an already-sorted key is fast) only
 * affects telemetry-log queries — these are write-mostly collections, not
 * reader-critical, and writes never needed the index.
 *
 * DRY-RUN BY DEFAULT: prints current index specs and the plan. --apply does
 * the swap, then verifies that NO index on each collection still carries
 * expireAfterSeconds and prints the result (non-zero exit if any remains).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/swap-ttl-to-plain-indexes.mjs           # dry run
 *   node scripts/maintenance/swap-ttl-to-plain-indexes.mjs --apply   # do it
 */
import { MongoClient } from 'mongodb';

const SWAPS = [
  { collection: 'api_usage', ttlName: 'ts_1', key: { ts: 1 }, plainName: 'ts_1' },
  { collection: 'gemini_usage', ttlName: 'gemini_usage_ttl_90d', key: { timestamp: 1 }, plainName: 'timestamp_1' },
  { collection: 'analytics_events', ttlName: 'ttl_90d_created_at', key: { created_at: 1 }, plainName: 'created_at_1' },
];

async function main() {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  console.log(`swap-ttl-to-plain-indexes (#2976): ${apply ? 'APPLY — will drop TTL indexes and recreate plain' : 'DRY RUN (pass --apply to swap)'}`);
  console.log('');

  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 1_200_000, // index builds on multi-million-doc collections
  });
  await client.connect();
  const db = client.db('bookstore');

  let failures = 0;

  try {
    for (const swap of SWAPS) {
      const col = db.collection(swap.collection);
      const indexes = await col.indexes();
      console.log(`── ${swap.collection} ──`);
      for (const idx of indexes) {
        const ttl = idx.expireAfterSeconds !== undefined ? ` [TTL ${idx.expireAfterSeconds}s]` : '';
        console.log(`   ${idx.name}: ${JSON.stringify(idx.key)}${ttl}`);
      }

      const ttlIdx = indexes.find((i) => i.name === swap.ttlName);
      const sameKeyPlain = indexes.find(
        (i) => JSON.stringify(i.key) === JSON.stringify(swap.key) && i.expireAfterSeconds === undefined,
      );

      if (!ttlIdx) {
        if (sameKeyPlain) {
          console.log(`   OK: '${swap.ttlName}' already gone and a plain index on ${JSON.stringify(swap.key)} exists ('${sameKeyPlain.name}') — nothing to do.`);
        } else {
          console.log(`   NOTE: TTL index '${swap.ttlName}' not found and no plain index on ${JSON.stringify(swap.key)} either.`);
          if (apply) {
            console.log(`   creating plain '${swap.plainName}' on ${JSON.stringify(swap.key)}...`);
            await col.createIndex(swap.key, { name: swap.plainName });
            console.log('   created.');
          } else {
            console.log(`   [dry-run] would create plain '${swap.plainName}' on ${JSON.stringify(swap.key)}.`);
          }
        }
      } else if (ttlIdx.expireAfterSeconds === undefined) {
        console.log(`   OK: '${swap.ttlName}' exists but is already plain — nothing to do.`);
      } else if (!apply) {
        console.log(`   [dry-run] would: dropIndex('${swap.ttlName}') then createIndex(${JSON.stringify(swap.key)}, { name: '${swap.plainName}' }) with NO expireAfterSeconds.`);
      } else {
        console.log(`   dropping TTL index '${swap.ttlName}'...`);
        await col.dropIndex(swap.ttlName);
        console.log(`   recreating plain '${swap.plainName}' on ${JSON.stringify(swap.key)}...`);
        await col.createIndex(swap.key, { name: swap.plainName });
        console.log('   swapped.');
      }

      // Verify: no index on this collection may carry expireAfterSeconds.
      const after = await col.indexes();
      const stillTtl = after.filter((i) => i.expireAfterSeconds !== undefined);
      if (stillTtl.length === 0) {
        console.log(`   VERIFY${apply ? '' : ' (current state)'}: no TTL indexes on ${swap.collection}. ✓`);
      } else {
        const msg = stillTtl.map((i) => `${i.name} (${i.expireAfterSeconds}s)`).join(', ');
        if (apply) {
          console.error(`   VERIFY FAILED: TTL still present on ${swap.collection}: ${msg}`);
          failures++;
        } else {
          console.log(`   [dry-run] TTL currently present on ${swap.collection}: ${msg} (would be removed by --apply)`);
        }
      }
      console.log('');
    }
  } finally {
    await client.close();
  }

  if (apply) {
    if (failures === 0) {
      console.log('All three collections verified TTL-free. Retention is now manual only (scripts/maintenance/prune-telemetry.mjs).');
    } else {
      console.error(`${failures} collection(s) still carry a TTL index — investigate before closing #2976.`);
      process.exit(1);
    }
  } else {
    console.log('Dry run complete — nothing changed. Re-run with --apply AFTER the #2976 PR is deployed to prod.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
