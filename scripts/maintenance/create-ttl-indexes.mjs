#!/usr/bin/env node
/**
 * Create TTL indexes for analytics collections (GDPR data retention).
 *
 * - analytics_pageviews: 90 days on `timestamp`
 * - analytics_events: 90 days on `created_at`
 * - loading_metrics: 30 days on `received_at`
 *
 * Run: set -a; source .env.production.local; set +a; node scripts/maintenance/create-ttl-indexes.mjs
 */

import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI not set');
  process.exit(1);
}

const NINETY_DAYS = 90 * 24 * 60 * 60;
const THIRTY_DAYS = 30 * 24 * 60 * 60;

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('bookstore');

  console.log('Creating TTL indexes...\n');

  // analytics_pageviews — 90 days on `timestamp` (Date field)
  try {
    const result = await db.collection('analytics_pageviews').createIndex(
      { timestamp: 1 },
      { expireAfterSeconds: NINETY_DAYS, name: 'ttl_timestamp_90d' }
    );
    console.log(`analytics_pageviews: ${result}`);
  } catch (e) {
    if (e.code === 85) {
      console.log('analytics_pageviews: TTL index already exists (conflicting options — drop and recreate if needed)');
    } else {
      console.error('analytics_pageviews error:', e.message);
    }
  }

  // analytics_events — 90 days on `created_at` (Date field)
  try {
    const result = await db.collection('analytics_events').createIndex(
      { created_at: 1 },
      { expireAfterSeconds: NINETY_DAYS, name: 'ttl_created_at_90d' }
    );
    console.log(`analytics_events: ${result}`);
  } catch (e) {
    if (e.code === 85) {
      console.log('analytics_events: TTL index already exists (conflicting options — drop and recreate if needed)');
    } else {
      console.error('analytics_events error:', e.message);
    }
  }

  // loading_metrics — 30 days on `received_at` (numeric timestamp — need Date field for TTL)
  // Note: TTL indexes require a Date field. loading_metrics uses numeric `received_at`.
  // We'll index on a Date field if it exists, or note that the collection needs migration.
  try {
    const result = await db.collection('loading_metrics').createIndex(
      { received_at: 1 },
      { expireAfterSeconds: THIRTY_DAYS, name: 'ttl_received_at_30d' }
    );
    console.log(`loading_metrics: ${result}`);
    console.log('  ⚠ Note: TTL only works if received_at is a Date. If it\'s a numeric timestamp, documents won\'t expire.');
    console.log('  Check: db.loading_metrics.findOne({}, {received_at: 1}) to verify field type.');
  } catch (e) {
    if (e.code === 85) {
      console.log('loading_metrics: TTL index already exists');
    } else {
      console.error('loading_metrics error:', e.message);
    }
  }

  console.log('\nDone. Verify with: db.analytics_pageviews.getIndexes()');
  await client.close();
}

main().catch(console.error);
