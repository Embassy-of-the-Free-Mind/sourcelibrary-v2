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

const filter = { visible: true, pages_count: { $gt: 0 } };
const translatedFilter = { ...filter, pages_translated: { $gt: 0 } };

// "Readable" = >=90% of OCR pages translated (excluding blank pages)
// This matches the definition used in /progress and pipeline milestones
const readableFilter = {
  ...filter,
  pages_translated: { $gt: 0 },
  $expr: { $gte: ['$pages_translated', { $multiply: [{ $subtract: [{ $ifNull: ['$pages_ocr', 0] }, { $ifNull: ['$pages_blank', 0] }] }, 0.9] }] },
};

// Visual artworks: single-object entries (paintings, prints, sculptures, etc.).
// Tagged content_type:'artwork' at import. They have 0 pages (image + metadata)
// or a few non-sequential images of the same object — not read like books.
// resource_type is too narrow: it omits sculpture, religious art, allegory, etc.
const artworkFilter = { visible: true, content_type: 'artwork' };

const [totalBooks, translatedToEnglish, firstTranslationCount, authorCount, languageCount, artworkCount, illustrationCount] = await Promise.all([
  books.countDocuments(filter),
  books.countDocuments(readableFilter),
  books.countDocuments({ ...translatedFilter, is_first_translation: true }),
  books.distinct('author', translatedFilter).then(a => a.length),
  books.distinct('language', translatedFilter).then(l => l.filter(x => x && !x.includes(',') && !x.includes(' and ')).length),
  books.countDocuments(artworkFilter),
  db.collection('gallery_images').countDocuments({}),
]);

const stats = { totalBooks, translatedToEnglish, firstTranslationCount, authorCount, languageCount, artworkCount, illustrationCount, updatedAt: new Date() };

await db.collection('system_config').updateOne(
  { _id: 'homepage_stats' },
  { $set: stats },
  { upsert: true },
);

console.log('Homepage stats updated:', stats);
await client.close();
