/**
 * Shared MongoDB client for local scripts.
 *
 * Enforces maxPoolSize: 1 (or small override), auto-close on exit,
 * and a configurable timeout to prevent zombie processes.
 *
 * Usage:
 *   import { getScriptClient } from '../lib/mongo.mjs';
 *   const { client, db } = await getScriptClient();
 *   // ... do work ...
 *   await client.close();
 *
 * With auto-cleanup (preferred):
 *   import { withMongo } from '../lib/mongo.mjs';
 *   await withMongo(async (db) => {
 *     const books = await db.collection('books').find().toArray();
 *   });
 *
 * Options:
 *   getScriptClient({ maxPoolSize: 3, timeoutMs: 120000 })
 *   withMongo(fn, { maxPoolSize: 3, timeoutMs: 120000 })
 */

import { MongoClient } from 'mongodb';

const DB_NAME = 'bookstore';
const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes

/**
 * Create a connected MongoClient configured for local scripts.
 *
 * @param {Object} [opts]
 * @param {number} [opts.maxPoolSize=1] - Connection pool size. Use 1 unless you need parallel DB ops.
 * @param {number} [opts.timeoutMs=300000] - Kill the process after this many ms (prevents zombies).
 * @param {boolean} [opts.noTimeout=false] - Disable the safety timeout (for long-running workers).
 * @returns {Promise<{ client: MongoClient, db: import('mongodb').Db }>}
 */
export async function getScriptClient(opts = {}) {
  const {
    maxPoolSize = 1,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    noTimeout = false,
    socketTimeoutMs = 30_000,
  } = opts;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI environment variable is required');
    process.exit(1);
  }

  const client = new MongoClient(uri, {
    maxPoolSize,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
    socketTimeoutMS: socketTimeoutMs,
    maxIdleTimeMS: 60_000,
  });

  // Safety timeout — kills zombie scripts
  let timer;
  if (!noTimeout) {
    timer = setTimeout(() => {
      console.error(`[mongo] Script timeout after ${timeoutMs / 1000}s — forcing exit`);
      client.close().catch(() => {});
      process.exit(1);
    }, timeoutMs);
    timer.unref(); // Don't keep the process alive just for the timer
  }

  // Auto-close on exit signals
  const cleanup = () => {
    client.close().catch(() => {});
    if (timer) clearTimeout(timer);
  };
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });

  await client.connect();
  const db = client.db(DB_NAME);

  return { client, db, cleanup };
}

/**
 * Run a function with a connected MongoDB client, auto-closing on completion.
 *
 * @param {(db: import('mongodb').Db, client: MongoClient) => Promise<void>} fn
 * @param {Object} [opts] - Same options as getScriptClient
 */
export async function withMongo(fn, opts = {}) {
  const { client, db } = await getScriptClient(opts);
  try {
    await fn(db, client);
  } finally {
    await client.close();
  }
}
