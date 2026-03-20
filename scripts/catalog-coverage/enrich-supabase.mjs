#!/usr/bin/env node
/**
 * Enrich USTC editions in Supabase with scan and translation coverage data.
 *
 * Adds/updates columns on ustc_editions:
 *   - has_iiif_scan (boolean)
 *   - iiif_manifest_url (text)
 *   - iiif_source (text)
 *   - has_english_translation (boolean)
 *   - in_source_library (boolean)
 *
 * Reads from MongoDB catalog_coverage, writes to Supabase via REST API.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   SUPABASE_SERVICE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY ~/vibecodingevents/.env.local | cut -d= -f2)
 *   node scripts/catalog-coverage/enrich-supabase.mjs
 *   node scripts/catalog-coverage/enrich-supabase.mjs --dry-run
 */

import { MongoClient } from 'mongodb';

const SUPABASE_URL = 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_KEY) {
  console.error('SUPABASE_SERVICE_KEY env var required');
  console.error('Export it: SUPABASE_SERVICE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY ~/vibecodingevents/.env.local | cut -d= -f2)');
  process.exit(1);
}

const headers = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=minimal',
};

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 200; // Supabase REST batch limit
const RATE_LIMIT_MS = 100; // ms between batches

async function addColumns() {
  console.log('Adding columns to ustc_editions (if not exist)...');
  const sql = `
    ALTER TABLE ustc_editions
      ADD COLUMN IF NOT EXISTS has_iiif_scan boolean DEFAULT false,
      ADD COLUMN IF NOT EXISTS iiif_manifest_url text,
      ADD COLUMN IF NOT EXISTS iiif_source text,
      ADD COLUMN IF NOT EXISTS has_english_translation boolean DEFAULT false,
      ADD COLUMN IF NOT EXISTS in_source_library boolean DEFAULT false;

    CREATE INDEX IF NOT EXISTS idx_ustc_has_scan ON ustc_editions (has_iiif_scan) WHERE has_iiif_scan = true;
    CREATE INDEX IF NOT EXISTS idx_ustc_has_translation ON ustc_editions (has_english_translation) WHERE has_english_translation = true;
    CREATE INDEX IF NOT EXISTS idx_ustc_in_sl ON ustc_editions (in_source_library) WHERE in_source_library = true;
  `;

  if (DRY_RUN) {
    console.log('  (dry run — would execute SQL)');
    return;
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });

  // RPC might not work for DDL — try the SQL endpoint instead
  if (!res.ok) {
    console.log('  RPC failed, trying direct SQL via pg_net or manual...');
    console.log('  Run this SQL in the Supabase SQL Editor:');
    console.log(sql);
    console.log('  Then re-run this script.');
    // Don't exit — columns might already exist
  } else {
    console.log('  Columns added.');
  }
}

async function enrichFromMongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI required'); process.exit(1); }

  const client = new MongoClient(uri, {
    socketTimeoutMS: 120_000,
    serverSelectionTimeoutMS: 30_000,
  });
  await client.connect();
  const db = client.db('bookstore');

  console.log('\nLoading coverage records with data to push...');

  let total = 0, updated = 0, failed = 0, skipped = 0;
  let lastId = null;
  const PAGE = 5000;

  // Collect batches of updates grouped by ustc_id
  let batch = [];

  async function flushBatch() {
    if (batch.length === 0) return;
    if (DRY_RUN) {
      updated += batch.length;
      batch = [];
      return;
    }

    // Supabase REST doesn't support batch PATCH by different IDs in one call.
    // We need to update one at a time or use RPC. Let's do individual PATCHes
    // but with parallelism.
    const PARALLEL = 10;
    for (let i = 0; i < batch.length; i += PARALLEL) {
      const chunk = batch.slice(i, i + PARALLEL);
      const results = await Promise.allSettled(chunk.map(async (item) => {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/ustc_editions?id=eq.${item.ustc_id}`,
          {
            method: 'PATCH',
            headers,
            body: JSON.stringify(item.data),
            signal: AbortSignal.timeout(10000),
          }
        );
        if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      }));

      for (const r of results) {
        if (r.status === 'fulfilled') updated++;
        else { failed++; if (failed <= 5) console.error(`  Error: ${r.reason.message}`); }
      }

      await new Promise(r => setTimeout(r, RATE_LIMIT_MS));
    }

    batch = [];
  }

  while (true) {
    const filter = { $or: [{ has_iiif_scan: true }, { has_english_translation: true }, { in_source_library: true }] };
    if (lastId) filter._id = { $gt: lastId };

    const docs = await db.collection('catalog_coverage')
      .find(filter, {
        projection: { _id: 1, ustc_id: 1, has_iiif_scan: 1, scan_sources: 1, iiif_manifest_url: 1, has_english_translation: 1, in_source_library: 1 },
      })
      .sort({ _id: 1 })
      .limit(PAGE)
      .toArray();

    if (docs.length === 0) break;

    for (const d of docs) {
      total++;
      const data = {
        has_iiif_scan: d.has_iiif_scan || false,
        has_english_translation: d.has_english_translation || false,
        in_source_library: d.in_source_library || false,
      };
      if (d.iiif_manifest_url) data.iiif_manifest_url = d.iiif_manifest_url;
      if (d.scan_sources?.length) data.iiif_source = d.scan_sources[0];

      batch.push({ ustc_id: d.ustc_id, data });

      if (batch.length >= BATCH_SIZE) {
        await flushBatch();
        process.stdout.write(`  ${total.toLocaleString()} read, ${updated.toLocaleString()} updated, ${failed} failed\r`);
      }
    }

    lastId = docs[docs.length - 1]._id;
  }

  // Final flush
  await flushBatch();

  await client.close();
  return { total, updated, failed, skipped };
}

async function main() {
  console.log('=== Enrich USTC Editions in Supabase ===');
  console.log(`Dry run: ${DRY_RUN}\n`);

  await addColumns();
  const start = Date.now();
  const { total, updated, failed } = await enrichFromMongo();
  const elapsed = ((Date.now() - start) / 1000).toFixed(0);

  console.log(`\n\n=== Complete ===`);
  console.log(`  Records read:    ${total.toLocaleString()}`);
  console.log(`  Updated:         ${updated.toLocaleString()}`);
  console.log(`  Failed:          ${failed.toLocaleString()}`);
  console.log(`  Elapsed:         ${elapsed}s`);
  if (DRY_RUN) console.log('  (DRY RUN — nothing written to Supabase)');
}

main().catch(err => { console.error(err); process.exit(1); });
