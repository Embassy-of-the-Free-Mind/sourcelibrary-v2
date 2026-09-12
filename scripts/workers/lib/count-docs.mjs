#!/usr/bin/env node
/**
 * Print a collection's estimated document count, and nothing else.
 *
 * Exists because `backup-corpus-text.sh` must refuse to dump a collection that
 * has gone missing or empty — a mongodump of a renamed collection SUCCEEDS and
 * writes a valid, empty archive, which is how you end up with a year of backups
 * of nothing. The Hetzner workers box has `mongodump` and `restic` but NOT
 * `mongosh`, so the guard is a node one-liner against the driver the repo
 * already depends on rather than a new package to install.
 *
 * Usage: node scripts/workers/lib/count-docs.mjs <db> <collection>
 * Exits non-zero (and prints nothing to stdout) if it cannot answer.
 */
import { MongoClient } from 'mongodb';

const [db, coll] = process.argv.slice(2);
if (!db || !coll) {
  console.error('usage: count-docs.mjs <db> <collection>');
  process.exit(2);
}
if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is not set');
  process.exit(2);
}

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
try {
  await client.connect();
  const n = await client.db(db).collection(coll).estimatedDocumentCount();
  process.stdout.write(String(n));
} catch (e) {
  console.error(`count failed for ${db}.${coll}: ${e.message}`);
  process.exit(1);
} finally {
  await client.close().catch(() => {});
}
