#!/usr/bin/env node
/**
 * Rename the mycology collection's display name to "Fungi & Mycology" so the
 * stored `collections.name` matches the redesigned collection-page heading
 * (and the catalogue dropdown/heading at /catalog?collection=mycology).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/rename-mycology-collection.mjs           # dry-run
 *   node scripts/maintenance/rename-mycology-collection.mjs --apply   # write
 */
import { MongoClient } from 'mongodb';

const APPLY = process.argv.includes('--apply');
const SLUG = 'mycology';
const NEW_NAME = 'Fungi & Mycology';

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

const client = await MongoClient.connect(uri);
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const collections = db.collection('collections');

const doc = await collections.findOne({ slug: SLUG }, { projection: { _id: 0, slug: 1, name: 1 } });
if (!doc) { console.error(`No collection with slug "${SLUG}"`); await client.close(); process.exit(1); }

console.log(`current name: ${JSON.stringify(doc.name)}`);
console.log(`new name:     ${JSON.stringify(NEW_NAME)}`);

if (doc.name === NEW_NAME) {
  console.log('Already up to date — nothing to do.');
} else if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to write.');
} else {
  const res = await collections.updateOne({ slug: SLUG }, { $set: { name: NEW_NAME } });
  console.log(`\nUpdated ${res.modifiedCount} document.`);
  const after = await collections.findOne({ slug: SLUG }, { projection: { _id: 0, name: 1 } });
  console.log(`confirmed name: ${JSON.stringify(after.name)}`);
}

await client.close();
