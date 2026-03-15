#!/usr/bin/env node
/**
 * Add TTL indexes for GDPR data retention compliance.
 * - analytics_pageviews: 90 days on `timestamp`
 * - analytics_events: 90 days on `created_at`
 * - loading_metrics: 30 days on `timestamp`
 *
 * Run: set -a; source .env.production.local; set +a; node scripts/maintenance/add-ttl-indexes.mjs
 */

import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

const client = new MongoClient(uri);

try {
  await client.connect();
  const db = client.db('bookstore');

  console.log('Creating TTL index: analytics_pageviews (90 days)...');
  await db.collection('analytics_pageviews').createIndex(
    { timestamp: 1 },
    { expireAfterSeconds: 90 * 24 * 60 * 60, name: 'ttl_90d_timestamp' }
  );

  console.log('Creating TTL index: analytics_events (90 days)...');
  await db.collection('analytics_events').createIndex(
    { created_at: 1 },
    { expireAfterSeconds: 90 * 24 * 60 * 60, name: 'ttl_90d_created_at' }
  );

  console.log('Creating TTL index: loading_metrics (30 days)...');
  // Drop conflicting non-TTL index if it exists
  try {
    await db.collection('loading_metrics').dropIndex('loading_metrics_ts_idx');
    console.log('  Dropped old non-TTL index: loading_metrics_ts_idx');
  } catch { /* index may not exist */ }
  await db.collection('loading_metrics').createIndex(
    { timestamp: 1 },
    { expireAfterSeconds: 30 * 24 * 60 * 60, name: 'ttl_30d_timestamp' }
  );

  console.log('Done. TTL indexes created.');
} finally {
  await client.close();
}
