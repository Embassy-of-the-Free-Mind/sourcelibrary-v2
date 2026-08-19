#!/usr/bin/env node
/**
 * Index the Librarian conversation collections.
 *
 * `embassy_threads` and `embassy_messages` carried nothing but `_id_`, so every
 * sidebar load ran collection scans with in-memory sorts. Measured 2026-08-19
 * on production: the per-thread preview query took ~528ms against 6,097
 * messages, and the list route ran twenty of them per request. That is how a
 * reader with 112 conversations was shown "No conversations yet" (#4070) — the
 * request lost the race with the render, and the client had no loading state.
 *
 * These are read-shape indexes for the three queries that exist:
 *   /api/embassy/threads?mine=true  → { creatorId, messageCount } sort lastMessageAt
 *   /api/embassy/threads            → { visibility, messageCount } sort lastMessageAt
 *   preview $lookup + thread detail → { threadId } sort createdAt
 *
 * Idempotent: createIndex is a no-op when the index already exists. Read-only
 * with respect to documents — it adds no fields and rewrites no rows.
 *
 *   node --env-file=.env.production.local scripts/maintenance/ensure-embassy-indexes.mjs
 */

import { MongoClient } from 'mongodb';

const INDEXES = [
  ['embassy_threads', { creatorId: 1, messageCount: 1, lastMessageAt: -1 }, 'creatorId_messageCount_lastMessageAt'],
  ['embassy_threads', { visibility: 1, messageCount: 1, lastMessageAt: -1 }, 'visibility_messageCount_lastMessageAt'],
  ['embassy_messages', { threadId: 1, createdAt: 1 }, 'threadId_createdAt'],
];

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set');
  process.exit(1);
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');

for (const [collection, keys, name] of INDEXES) {
  const created = await db.collection(collection).createIndex(keys, { name, background: true });
  console.log(`${collection}: ${created}`);
}

for (const collection of ['embassy_threads', 'embassy_messages']) {
  const names = (await db.collection(collection).indexes()).map(i => i.name);
  console.log(`${collection} indexes now: ${names.join(', ')}`);
}

await client.close();
