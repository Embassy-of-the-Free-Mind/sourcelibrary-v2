#!/usr/bin/env node
/**
 * Seed system_config.timeline_filters with pre-computed language and collection lists.
 * Run periodically or after large imports. Avoids slow distinct() queries at request time.
 *
 * Usage: set -a; source .env.production.local; set +a; node scripts/seed-timeline-filters.mjs
 */
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

const client = new MongoClient(uri);

try {
  await client.connect();
  const db = client.db('bookstore');
  const filter = { hidden: { $ne: true }, year: { $exists: true, $ne: null } };

  console.log('Fetching distinct languages...');
  const languages = (await db.collection('books').distinct('language', filter)).filter(Boolean).sort();

  console.log('Fetching distinct categories...');
  const collections = (await db.collection('books').distinct('categories', filter)).filter(Boolean).sort();

  const data = { languages, collections };

  await db.collection('system_config').updateOne(
    { _id: 'timeline_filters' },
    { $set: { data, updated_at: new Date() } },
    { upsert: true },
  );

  console.log(`Cached ${languages.length} languages, ${collections.length} collections into system_config.timeline_filters`);
} finally {
  await client.close();
}
