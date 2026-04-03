#!/usr/bin/env node
/**
 * Supabase Analytics Sync Worker
 *
 * Runs on Hetzner every 5 minutes via cron. Incrementally syncs
 * analytics collections from MongoDB → Supabase Postgres.
 *
 * gemini_usage is NOT synced here — it uses dual-write in gemini-logger.ts.
 * Materialized view refreshes are handled by pg_cron inside Supabase.
 *
 * Collections synced:
 *   - pipeline_snapshots
 *   - analytics_pageviews
 *   - analytics_events
 *   - cron_runs
 *   - loading_metrics
 *
 * Env vars required:
 *   MONGODB_URI, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Crontab entry (every 5 min):
 *   flock -n /tmp/sl-supabase-sync.lock node /root/sourcelibrary/scripts/workers/supabase-sync.mjs
 */

import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';

const MONGODB_URI = process.env.MONGODB_URI;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!MONGODB_URI || !SUPABASE_SERVICE_KEY) {
  console.error(`[${new Date().toISOString()}] Missing MONGODB_URI or SUPABASE_SERVICE_ROLE_KEY`);
  process.exit(1);
}

const BATCH_SIZE = 500;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

// ── Collection configs (same transforms as backfill script) ──────────

const COLLECTIONS = [
  {
    name: 'pipeline_snapshots',
    mongoCollection: 'pipeline_snapshots',
    supabaseTable: 'pipeline_snapshots',
    timestampField: 'timestamp',
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
    transform: (doc) => ({
      event: doc.event,
      book_id: doc.book_id || null,
      page_id: doc.page_id || null,
      ip: doc.ip || null,
      timestamp: doc.timestamp instanceof Date ? doc.timestamp
        : typeof doc.timestamp === 'number' ? new Date(doc.timestamp)
        : doc.created_at instanceof Date ? doc.created_at
        : typeof doc.created_at === 'number' ? new Date(doc.created_at)
        : new Date(),
    }),
  },
  {
    name: 'cron_runs',
    mongoCollection: 'cron_runs',
    supabaseTable: 'cron_runs',
    timestampField: 'timestamp',
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

// ── Sync logic ───────────────────────────────────────────────────────

async function getLastTimestamp(table) {
  const { data } = await supabase
    .from(table)
    .select('timestamp')
    .order('timestamp', { ascending: false })
    .limit(1);
  return data?.[0]?.timestamp ? new Date(data[0].timestamp) : null;
}

async function syncCollection(db, config) {
  const since = await getLastTimestamp(config.supabaseTable);
  if (!since) {
    // No data — skip (use backfill script for initial load)
    return { name: config.name, synced: 0, note: 'empty — run backfill first' };
  }

  const query = { [config.timestampField]: { $gt: since } };
  const cursor = db.collection(config.mongoCollection)
    .find(query)
    .sort({ [config.timestampField]: 1 })
    .batchSize(BATCH_SIZE);

  let synced = 0;
  let errors = 0;
  let batch = [];

  for await (const doc of cursor) {
    try {
      batch.push(config.transform(doc));
    } catch {
      errors++;
      continue;
    }

    if (batch.length >= BATCH_SIZE) {
      const { error } = await supabase.from(config.supabaseTable).insert(batch);
      if (error) {
        errors += batch.length;
      } else {
        synced += batch.length;
      }
      batch = [];
    }
  }

  if (batch.length > 0) {
    const { error } = await supabase.from(config.supabaseTable).insert(batch);
    if (error) {
      errors += batch.length;
    } else {
      synced += batch.length;
    }
  }

  return { name: config.name, synced, errors: errors || undefined };
}

// ── Main ─────────────────────────────────────────────────────────────

const start = Date.now();
const mongoClient = new MongoClient(MONGODB_URI, { maxPoolSize: 2 });
await mongoClient.connect();
const db = mongoClient.db('bookstore');

const results = [];
for (const config of COLLECTIONS) {
  const result = await syncCollection(db, config);
  results.push(result);
}

// ── pages_images sync (image URLs for display backfill) ──────────────
// Syncs pages updated in the last 10 minutes (covers archiving + backfill writes).
// Uses updated_at from MongoDB, upserts to Supabase.
{
  const since = new Date(Date.now() - 10 * 60 * 1000); // last 10 min
  const pages = await db.collection('pages')
    .find(
      { updated_at: { $gt: since }, archived_photo: { $exists: true } },
      { projection: { id: 1, _id: 1, book_id: 1, page_number: 1, archived_photo: 1, display_photo: 1, thumbnail_blob: 1 } }
    )
    .batchSize(5000)
    .maxTimeMS(10_000)
    .toArray()
    .catch(() => []);

  if (pages.length > 0) {
    const rows = pages.map(p => ({
      id: p.id || p._id?.toString(),
      book_id: p.book_id,
      page_number: p.page_number,
      archived_photo: p.archived_photo || null,
      display_photo: p.display_photo || null,
      thumbnail_blob: p.thumbnail_blob || null,
    }));

    let synced = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase.from('pages_images').upsert(batch, { onConflict: 'id' });
      if (!error) synced += batch.length;
    }

    results.push({ name: 'pages_images', synced });
  }
}

await mongoClient.close();

const totalSynced = results.reduce((s, r) => s + r.synced, 0);
const elapsed = ((Date.now() - start) / 1000).toFixed(1);

// Only log if there's something to report
if (totalSynced > 0 || results.some(r => r.errors)) {
  const parts = results
    .filter(r => r.synced > 0 || r.errors || r.note)
    .map(r => {
      let s = `${r.name}:${r.synced}`;
      if (r.errors) s += `(${r.errors}err)`;
      if (r.note) s = `${r.name}:${r.note}`;
      return s;
    });
  console.log(`[${new Date().toISOString()}] sync ${totalSynced} rows in ${elapsed}s — ${parts.join(', ')}`);
}
