#!/usr/bin/env node
/**
 * Backfill MongoDB analytics collections → Supabase Postgres.
 *
 * Collections synced:
 *   - gemini_usage (~1.4M rows, the big one)
 *   - pipeline_snapshots
 *   - analytics_pageviews
 *   - analytics_events
 *   - cron_runs
 *   - loading_metrics
 *
 * Modes:
 *   --full        Backfill everything (first run)
 *   --incremental Sync only new records since last sync (default)
 *   --collection  Sync only one collection (e.g. --collection gemini_usage)
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/migration/backfill-supabase-analytics.mjs --full
 */

import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';

// ── Config ───────────────────────────────────────────────────────────

const MONGODB_URI = process.env.MONGODB_URI;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!MONGODB_URI) { console.error('Missing MONGODB_URI'); process.exit(1); }
if (!SUPABASE_SERVICE_KEY) { console.error('Missing SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const args = process.argv.slice(2);
const FULL_MODE = args.includes('--full');
const ONLY_COLLECTION = args.find((_, i, a) => a[i - 1] === '--collection');
const BATCH_SIZE = 1000;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// ── Collection Configs ───────────────────────────────────────────────

const COLLECTIONS = [
  {
    name: 'gemini_usage',
    mongoCollection: 'gemini_usage',
    supabaseTable: 'gemini_usage',
    timestampField: 'timestamp',
    idField: 'id',
    transform: (doc) => ({
      id: doc.id || doc._id?.toString() || `gu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: doc.timestamp,
      type: doc.type,
      mode: doc.mode || null,
      model: doc.model || null,
      book_id: doc.book_id || null,
      book_title: doc.book_title || null,
      page_count: doc.page_count || 0,
      input_tokens: doc.input_tokens || 0,
      output_tokens: doc.output_tokens || 0,
      cost_usd: doc.cost_usd || 0,
      status: doc.status || null,
      error_message: doc.error_message || null,
      error_category: doc.error_category || null,
      duration_ms: doc.duration_ms || null,
      prompt_version: doc.prompt_version || null,
      job_id: doc.job_id || null,
      batch_job_id: doc.batch_job_id || null,
      endpoint: doc.endpoint || null,
      completed_at: doc.completed_at || null,
    }),
  },
  {
    name: 'pipeline_snapshots',
    mongoCollection: 'pipeline_snapshots',
    supabaseTable: 'pipeline_snapshots',
    timestampField: 'timestamp',
    idField: null, // serial
    transform: (doc) => ({
      timestamp: doc.timestamp,
      source: doc.source || 'hetzner-worker',
      funnel: doc.funnel || null,
      pages: doc.pages || null,
      books: doc.books || null,
      active_batch: doc.active_batch || null,
    }),
  },
  {
    name: 'analytics_pageviews',
    mongoCollection: 'analytics_pageviews',
    supabaseTable: 'analytics_pageviews',
    timestampField: 'timestamp',
    idField: null,
    transform: (doc) => ({
      path: doc.path,
      referrer: doc.referrer || null,
      country: doc.country || null,
      user_agent: doc.userAgent || null,
      ip: doc.ip || null,
      timestamp: doc.timestamp,
    }),
  },
  {
    name: 'analytics_events',
    mongoCollection: 'analytics_events',
    supabaseTable: 'analytics_events',
    timestampField: 'timestamp',
    idField: null,
    transform: (doc) => ({
      event: doc.event,
      book_id: doc.book_id || null,
      page_id: doc.page_id || null,
      ip: doc.ip || null,
      timestamp: doc.timestamp || doc.created_at,
    }),
  },
  {
    name: 'cron_runs',
    mongoCollection: 'cron_runs',
    supabaseTable: 'cron_runs',
    timestampField: 'timestamp',
    idField: null,
    transform: (doc) => ({
      cron: doc.cron,
      timestamp: doc.timestamp,
      duration_ms: doc.duration_ms || null,
      status: doc.status || null,
      health_grade: doc.health_grade || null,
      actions: doc.actions || null,
      decisions: doc.decisions || null,
      errors: doc.errors || null,
      error_count: doc.error_count || 0,
      summary: doc.summary || null,
    }),
  },
  {
    name: 'loading_metrics',
    mongoCollection: 'loading_metrics',
    supabaseTable: 'loading_metrics',
    timestampField: 'received_at',
    idField: null,
    transform: (doc) => ({
      name: doc.name,
      duration: doc.duration,
      timestamp: doc.received_at instanceof Date ? doc.received_at
        : typeof doc.received_at === 'number' ? new Date(doc.received_at)
        : doc.timestamp instanceof Date ? doc.timestamp
        : new Date(),
      metadata: doc.metadata || null,
    }),
  },
];

// ── Helpers ──────────────────────────────────────────────────────────

async function getLastSyncTimestamp(table) {
  const { data } = await supabase
    .from(table)
    .select('timestamp')
    .order('timestamp', { ascending: false })
    .limit(1);
  return data?.[0]?.timestamp ? new Date(data[0].timestamp) : null;
}

async function syncCollection(mongo, config) {
  const collection = mongo.collection(config.mongoCollection);

  // Determine start point
  let since = null;
  if (!FULL_MODE) {
    since = await getLastSyncTimestamp(config.supabaseTable);
    if (since) {
      console.log(`  Incremental from: ${since.toISOString()}`);
    } else {
      console.log(`  No existing data — doing full backfill`);
    }
  }

  const query = since ? { [config.timestampField]: { $gt: since } } : {};
  const total = await collection.countDocuments(query);
  console.log(`  ${total.toLocaleString()} documents to sync`);

  if (total === 0) return { synced: 0, errors: 0 };

  let synced = 0;
  let errors = 0;
  const cursor = collection.find(query).sort({ [config.timestampField]: 1 }).batchSize(BATCH_SIZE);

  let batch = [];
  for await (const doc of cursor) {
    try {
      batch.push(config.transform(doc));
    } catch (e) {
      errors++;
      continue;
    }

    if (batch.length >= BATCH_SIZE) {
      const result = await flushBatch(config, batch);
      synced += result.inserted;
      errors += result.errors;
      batch = [];

      if (synced % 10000 === 0) {
        const pct = total > 0 ? ((synced / total) * 100).toFixed(1) : '?';
        console.log(`  ${synced.toLocaleString()} / ${total.toLocaleString()} (${pct}%)`);
      }
    }
  }

  // Flush remaining
  if (batch.length > 0) {
    const result = await flushBatch(config, batch);
    synced += result.inserted;
    errors += result.errors;
  }

  return { synced, errors };
}

async function flushBatch(config, batch) {
  try {
    // Use upsert for collections with a natural ID, insert for serial IDs
    if (config.idField) {
      const { error } = await supabase
        .from(config.supabaseTable)
        .upsert(batch, { onConflict: config.idField, ignoreDuplicates: true });
      if (error) {
        console.error(`  Batch error (${config.name}): ${error.message}`);
        return { inserted: 0, errors: batch.length };
      }
    } else {
      const { error } = await supabase
        .from(config.supabaseTable)
        .insert(batch);
      if (error) {
        // On duplicate, try one-by-one
        if (error.message.includes('duplicate') || error.message.includes('unique')) {
          let ok = 0;
          for (const row of batch) {
            const { error: e2 } = await supabase.from(config.supabaseTable).insert(row);
            if (!e2) ok++;
          }
          return { inserted: ok, errors: batch.length - ok };
        }
        console.error(`  Batch error (${config.name}): ${error.message}`);
        return { inserted: 0, errors: batch.length };
      }
    }
    return { inserted: batch.length, errors: 0 };
  } catch (e) {
    console.error(`  Unexpected error: ${e.message}`);
    return { inserted: 0, errors: batch.length };
  }
}

// ── Main ─────────────────────────────────────────────────────────────

const mongoClient = new MongoClient(MONGODB_URI, { maxPoolSize: 3 });
await mongoClient.connect();
const mongo = mongoClient.db('bookstore');

console.log(`\nSupabase Analytics Backfill (${FULL_MODE ? 'FULL' : 'INCREMENTAL'})\n`);

const collectionsToSync = ONLY_COLLECTION
  ? COLLECTIONS.filter(c => c.name === ONLY_COLLECTION)
  : COLLECTIONS;

if (collectionsToSync.length === 0) {
  console.error(`Unknown collection: ${ONLY_COLLECTION}`);
  process.exit(1);
}

const results = [];
for (const config of collectionsToSync) {
  console.log(`\n[${config.name}]`);
  const start = Date.now();
  const result = await syncCollection(mongo, config);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`  Done: ${result.synced.toLocaleString()} synced, ${result.errors} errors (${elapsed}s)`);
  results.push({ name: config.name, ...result, elapsed });
}

// Refresh materialized views
console.log('\nRefreshing materialized views...');
try {
  // Use pg directly for REFRESH since Supabase JS client can't run arbitrary SQL
  const pg = await import('pg');
  const pgClient = new pg.default.Client({
    host: 'db.ykhxaecbbxaaqlujuzde.supabase.co',
    port: 5432,
    user: process.env.PGUSER || 'cli_login_postgres',
    password: process.env.PGPASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  });
  await pgClient.connect();
  await pgClient.query('SET ROLE postgres');
  await pgClient.query('REFRESH MATERIALIZED VIEW dashboard_usage');
  console.log('  OK: dashboard_usage');
  await pgClient.query('REFRESH MATERIALIZED VIEW pipeline_velocity');
  console.log('  OK: pipeline_velocity');
  await pgClient.end();
} catch (e) {
  console.warn(`  Materialized view refresh failed: ${e.message}`);
  console.warn('  Run manually: REFRESH MATERIALIZED VIEW CONCURRENTLY dashboard_usage;');
}

await mongoClient.close();

// Summary
console.log('\n=== Summary ===');
let totalSynced = 0;
for (const r of results) {
  console.log(`  ${r.name}: ${r.synced.toLocaleString()} rows (${r.elapsed}s)`);
  totalSynced += r.synced;
}
console.log(`  Total: ${totalSynced.toLocaleString()} rows`);
