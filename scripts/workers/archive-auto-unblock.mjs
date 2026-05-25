#!/usr/bin/env node
/**
 * Archive Auto-Unblock Worker
 *
 * Clears archive_metadata.blocked on books that hit the 5-strike circuit
 * breaker with transient failure reasons (network errors, source 5xx,
 * opj_decompress crashes, fetch failed, etc.) after MIN_AGE_DAYS so they get
 * another attempt. Auth blocks (HTTP 401/403) are left alone — those need
 * source rotation, not retry.
 *
 * Without this, transient-failure books accumulate forever. 13 books got
 * blocked over a 4-day window in the May 2026 stuck-archive incident — the
 * archive-bulk circuit breaker is meant to stop wasteful retries within one
 * outage, not to permanently quarantine books.
 *
 * Run via Hetzner cron (daily is plenty — blocks accumulate slowly):
 *   set -a; source .env.production.local; set +a; node scripts/workers/archive-auto-unblock.mjs
 */

import { MongoClient } from 'mongodb';

const MIN_AGE_DAYS = 14;
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

// Reasons that benefit from a retry. Auth (401/403) deliberately omitted.
const RETRYABLE_REASON_PATTERNS = [
  /^bulk-archive failed 5x: terminated$/,
  /^bulk-archive failed 5x: spawnSync /,
  /^bulk-archive failed 5x: HTTP 5\d\d/,
  /^bulk-archive failed 5x: fetch failed/,
  /^bulk-archive failed 5x: This operation was aborted/,
  /^bulk-archive failed 5x: socket hang up/,
  /^bulk-archive failed 5x: ECONNRESET/,
  /^bulk-archive failed 5x: ETIMEDOUT/,
];

async function unblockCollection(db, name) {
  const cutoff = new Date(Date.now() - MIN_AGE_DAYS * 24 * 3600e3);
  const candidates = await db.collection(name).find(
    {
      'archive_metadata.blocked': true,
      'archive_metadata.blocked_at': { $lt: cutoff },
      'archive_metadata.blocked_reason': { $in: RETRYABLE_REASON_PATTERNS },
    },
    { projection: { id: 1, title: 1, 'archive_metadata.blocked_reason': 1 } }
  ).toArray();

  if (candidates.length === 0) {
    console.log(`[archive-auto-unblock] ${name}: nothing to unblock (>${MIN_AGE_DAYS}d old, retryable reason)`);
    return 0;
  }

  console.log(`[archive-auto-unblock] ${name}: unblocking ${candidates.length} books`);
  for (const b of candidates.slice(0, 10)) {
    console.log(`  - ${(b.title || '').slice(0, 60)} | ${b.archive_metadata.blocked_reason}`);
  }
  if (candidates.length > 10) console.log(`  ... and ${candidates.length - 10} more`);

  const ids = candidates.map(b => b.id);
  const result = await db.collection(name).updateMany(
    { id: { $in: ids } },
    { $unset: {
      'archive_metadata.blocked': '',
      'archive_metadata.blocked_at': '',
      'archive_metadata.blocked_reason': '',
      'archive_metadata.bulk_failures': '',
      'archive_metadata.bulk_last_error': '',
      'archive_metadata.bulk_last_failed_at': '',
    }}
  );
  return result.modifiedCount;
}

async function run() {
  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  console.log(`[archive-auto-unblock] Starting at ${new Date().toISOString()} (cutoff: ${MIN_AGE_DAYS}d)`);

  const liveUnblocked = await unblockCollection(db, 'books');
  const warehouseUnblocked = await unblockCollection(db, 'books_warehouse');

  console.log(`[archive-auto-unblock] Done: ${liveUnblocked} live + ${warehouseUnblocked} warehouse unblocked`);

  await client.close();
}

run().catch(err => { console.error('[archive-auto-unblock] FAILED:', err); process.exit(1); });
