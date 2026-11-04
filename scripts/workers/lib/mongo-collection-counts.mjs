#!/usr/bin/env node
/**
 * Print every collection in a database with its estimated document count, as JSON.
 *
 * PRIOR ART: scripts/workers/lib/count-docs.mjs — counts ONE named collection;
 * backup-mongo-rest.sh needs the whole list, enumerated at run time, so that a
 * collection created next month is backed up without anyone editing a list.
 *
 * Usage: node scripts/workers/lib/mongo-collection-counts.mjs <db> [--exclude a,b,c]
 * Stdout: {"collection": estimatedCount, ...}  (views and system.* are omitted:
 * mongodump writes a view's definition, never data, and system.* is server-owned).
 * Exits non-zero (and prints nothing to stdout) if it cannot answer.
 */
import { MongoClient } from 'mongodb';

const db = process.argv[2];
const xi = process.argv.indexOf('--exclude');
const exclude = new Set(xi > -1 ? process.argv[xi + 1].split(',').filter(Boolean) : []);
if (!db) { console.error('usage: mongo-collection-counts.mjs <db> [--exclude a,b]'); process.exit(2); }
if (!process.env.MONGODB_URI) { console.error('MONGODB_URI is not set'); process.exit(2); }

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
try {
  await client.connect();
  const d = client.db(db);
  const cols = await d.listCollections({}, { nameOnly: false }).toArray();
  const out = {};
  for (const c of cols.sort((a, b) => a.name.localeCompare(b.name))) {
    if (c.type !== 'collection' || c.name.startsWith('system.') || exclude.has(c.name)) continue;
    out[c.name] = await d.collection(c.name).estimatedDocumentCount();
  }
  process.stdout.write(JSON.stringify(out));
} catch (e) {
  console.error(`listCollections failed for ${db}: ${e.message}`);
  process.exit(1);
} finally {
  await client.close().catch(() => {});
}
