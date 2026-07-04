#!/usr/bin/env node
/**
 * Partial indexes on entities.wikidata_* fields.
 *
 * The entities collection is ~1M docs (~1.9GB), but only a few thousand have
 * Wikidata enrichment. /explore/timeline, /explore (hub stats), and
 * /api/explore/map filter on these fields — without indexes each query was a
 * full collection scan that timed out (the 2026-07-04 timeline outage: the
 * error fallback then got frozen into the static page cache).
 *
 * Idempotent — safe to re-run. Already applied to prod 2026-07-04.
 *
 * Usage: set -a; source .env.production.local; set +a; node scripts/maintenance/create-entities-wikidata-indexes.mjs
 */
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI not set');
  process.exit(1);
}

const INDEXES = [
  { field: 'wikidata_birth_date', name: 'wikidata_birth_date_partial' },
  { field: 'wikidata_death_date', name: 'wikidata_death_date_partial' },
  { field: 'wikidata_coordinates', name: 'wikidata_coordinates_partial' },
  { field: 'wikidata_id', name: 'wikidata_id_partial' },
];

const client = await MongoClient.connect(uri);
const col = client.db('bookstore').collection('entities');

for (const { field, name } of INDEXES) {
  try {
    await col.createIndex(
      { [field]: 1 },
      { name, partialFilterExpression: { [field]: { $exists: true } } },
    );
    console.log(`OK: entities.${name}`);
  } catch (e) {
    if (e.codeName === 'IndexOptionsConflict' || e.code === 85 || e.code === 86) {
      console.log(`EXISTS: entities.${name}`);
    } else {
      console.error(`ERROR: entities.${name} — ${e.message}`);
      process.exitCode = 1;
    }
  }
}

await client.close();
