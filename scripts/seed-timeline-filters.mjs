#!/usr/bin/env node
/**
 * Seed system_config with pre-computed timeline data:
 *   - timeline_filters: language and collection lists for filter dropdowns
 *   - timeline_overview: full decade buckets with language breakdown + summary stats
 *
 * Run periodically or after large imports. Avoids 30-80s aggregations at request time.
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
  const baseFilter = { hidden: { $ne: true }, year: { $exists: true, $ne: null } };

  // 1. Filters
  console.log('Fetching distinct languages...');
  const languages = (await db.collection('books').distinct('language', baseFilter)).filter(Boolean).sort();

  console.log('Fetching distinct categories...');
  const collections = (await db.collection('books').distinct('categories', baseFilter)).filter(Boolean).sort();

  await db.collection('system_config').updateOne(
    { _id: 'timeline_filters' },
    { $set: { data: { languages, collections }, updated_at: new Date() } },
    { upsert: true },
  );
  console.log(`Cached ${languages.length} languages, ${collections.length} collections into timeline_filters`);

  // 2. Overview (decade buckets)
  console.log('Computing decade buckets...');
  const rawDecades = await db.collection('books').aggregate([
    { $match: baseFilter },
    {
      $group: {
        _id: { $multiply: [{ $floor: { $divide: ['$year', 10] } }, 10] },
        count: { $sum: 1 },
        languages: { $push: '$language' },
      },
    },
    { $sort: { _id: 1 } },
  ]).toArray();

  const decades = rawDecades.map(d => {
    const langCounts = {};
    for (const lang of d.languages) {
      const key = lang || 'Unknown';
      langCounts[key] = (langCounts[key] || 0) + 1;
    }
    const langs = Object.entries(langCounts)
      .map(([lang, count]) => ({ lang, count }))
      .sort((a, b) => b.count - a.count);
    return { decade: d._id, count: d.count, languages: langs };
  });

  const total = decades.reduce((sum, d) => sum + d.count, 0);
  const allYears = decades.map(d => d.decade);
  const yearRange = {
    min: allYears.length ? allYears[0] : 0,
    max: allYears.length ? allYears[allYears.length - 1] + 9 : 0,
  };

  const globalLangCounts = {};
  for (const d of decades) {
    for (const l of d.languages) {
      globalLangCounts[l.lang] = (globalLangCounts[l.lang] || 0) + l.count;
    }
  }
  const topLanguages = Object.entries(globalLangCounts)
    .map(([lang, count]) => ({ lang, count }))
    .sort((a, b) => b.count - a.count);

  const overview = {
    decades,
    summary: { total, yearRange, topLanguages },
    filters: {
      languages: languages.filter(Boolean).sort(),
      collections: collections.filter(Boolean).sort(),
    },
  };

  await db.collection('system_config').updateOne(
    { _id: 'timeline_overview' },
    { $set: { data: overview, updated_at: new Date() } },
    { upsert: true },
  );
  console.log(`Cached ${decades.length} decades, ${total} books into timeline_overview`);
} finally {
  await client.close();
}
