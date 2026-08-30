#!/usr/bin/env node
/**
 * upgrade-explorer-key-limits-2026-08.mjs — one-time sweep for #4366.
 *
 * The Explorer tier was raised from 100 pages/day + 10 req/min to
 * 2,000 + 60 (a free key must out-rank anonymous access). Tier defaults are
 * read from DATASET_TIERS at request time for /text and /image, but
 * /dataset/v1/pages reads the rate_limit STORED ON THE KEY DOC at mint time —
 * so existing explorer keys keep the old numbers until this sweep runs.
 *
 * Scope guard: only explorer-tier dataset keys (key_hash present) still
 * carrying exactly the old defaults; hand-tuned keys are left alone.
 *
 * Usage:  node --env-file=.env.production.local scripts/maintenance/upgrade-explorer-key-limits-2026-08.mjs [--dry-run]
 */
import { MongoClient } from 'mongodb';

const dry = process.argv.includes('--dry-run');
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const col = client.db('bookstore').collection('api_keys');

const filter = {
  key_hash: { $exists: true },
  tier: 'explorer',
  'rate_limit.pages_per_day': 100,
  'rate_limit.requests_per_minute': 10,
};

const matching = await col.countDocuments(filter);
console.log(`explorer keys still on 100/day + 10/min: ${matching}`);

if (!dry && matching > 0) {
  const res = await col.updateMany(filter, {
    $set: {
      'rate_limit.pages_per_day': 2000,
      'rate_limit.requests_per_minute': 60,
    },
  });
  console.log(`updated: ${res.modifiedCount}`);
} else if (dry) {
  console.log('(dry run — no writes)');
}

await client.close();
