#!/usr/bin/env node
/**
 * Compute homepage stats and cache them in system_config.
 * Run periodically (e.g. daily cron) or manually.
 *
 * Usage: set -a; source .env.production.local; set +a; node scripts/maintenance/update-homepage-stats.mjs
 */
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

const client = await MongoClient.connect(uri);
const db = client.db('bookstore');
const books = db.collection('books');

const filter = { hidden: { $ne: true }, pages_count: { $gt: 0 } };
const translatedFilter = { ...filter, pages_translated: { $gt: 0 } };

const [totalBooks, translatedToEnglish, firstTranslationCount, authorCount, languageCount] = await Promise.all([
  books.countDocuments(filter),
  books.countDocuments(translatedFilter),
  books.countDocuments({ ...translatedFilter, is_first_translation: true }),
  books.distinct('author', translatedFilter).then(a => a.length),
  books.distinct('language', translatedFilter).then(l => l.filter(x => x && !x.includes(',') && !x.includes(' and ')).length),
]);

const stats = { totalBooks, translatedToEnglish, firstTranslationCount, authorCount, languageCount, updatedAt: new Date() };

await db.collection('system_config').updateOne(
  { _id: 'homepage_stats' },
  { $set: stats },
  { upsert: true },
);

console.log('Homepage stats updated:', stats);
await client.close();
