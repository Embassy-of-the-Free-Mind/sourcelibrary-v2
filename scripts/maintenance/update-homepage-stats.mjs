#!/usr/bin/env node
/**
 * Compute homepage stats and cache them in system_config.
 * Run periodically (e.g. daily cron) or manually.
 *
 * Usage: set -a; source .env.production.local; set +a; node scripts/maintenance/update-homepage-stats.mjs
 */
import { MongoClient } from 'mongodb';
import { countDistinctLanguages } from '../lib/language-count.mjs';
import { countFirstTranslatedWorks } from '../lib/contents-works.mjs';

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

const [totalBooks, translatedToEnglish, firstTranslationCount, authorCount, languageCount, artworkCount, illustrationCount, verificationReadable, verificationChecked] = await Promise.all([
  books.countDocuments(filter),
  books.countDocuments(readableFilter),
  books.countDocuments({ ...translatedFilter, is_first_translation: true }),
  books.distinct('author', translatedFilter).then(a => a.length),
  // Distinct SOURCE languages across the opened corpus (same `filter` as totalBooks,
  // so the two stats are consistent). countDistinctLanguages splits compound labels
  // and drops variants/junk — a naive distinct().length over-counts ~1.6x (#lang-count).
  books.distinct('language', filter).then(countDistinctLanguages),
  books.countDocuments(artworkFilter),
  db.collection('gallery_images').countDocuments({}),
  // First-translation verification coverage (#2332 Task 3): of all readable+visible
  // books (the FT-eligible pool = translatedFilter), how many have a catalog disposition?
  books.countDocuments(translatedFilter),
  books.countDocuments({ ...translatedFilter, 'translation_verification.disposition': { $exists: true } }),
]);

const verification_coverage = {
  checked: verificationChecked,
  readable: verificationReadable,
  pct: verificationReadable ? +(100 * verificationChecked / verificationReadable).toFixed(1) : 0,
};

// Book-floored FT WORK count (#2913). firstTranslationCount above counts FT *books*;
// a container book holds several works. `firstTranslatedWorks` decomposes containers
// via the provisional contents_works[] manifest (#2916), counting only individually
// ft-verify'd constituents above the book floor (honest, == books until verification
// lands), and `…Provisional` counts every chapter-derived constituent (upper bound).
// Both are book-floored (≥ firstTranslationCount), asserted by countFirstTranslatedWorks.
const ftBooks = await books.find({ ...translatedFilter, is_first_translation: true })
  .project({ _id: 0, contents_works: 1 }).toArray();
const firstTranslatedWorks = countFirstTranslatedWorks(ftBooks, { mode: 'verified' });
const firstTranslatedWorksProvisional = countFirstTranslatedWorks(ftBooks, { mode: 'provisional' });

// Corpus-census ledger coverage (#2933, surfaced on /census): how many books
// have a documented grounded prior-translation search in the append-only
// first_translation_attempts ledger. Keep in sync with prewarm-browse.mjs.
const attempts = db.collection('first_translation_attempts');
const census_ledger = {
  attempts: await attempts.estimatedDocumentCount(),
  booksSearched: (await attempts.distinct('book_id', { 'queries.0': { $exists: true } })).length,
};

const stats = { totalBooks, translatedToEnglish, firstTranslationCount, firstTranslatedWorks, firstTranslatedWorksProvisional, authorCount, languageCount, artworkCount, illustrationCount, verification_coverage, census_ledger, updatedAt: new Date() };

await db.collection('system_config').updateOne(
  { _id: 'homepage_stats' },
  { $set: stats },
  { upsert: true },
);

console.log('Homepage stats updated:', stats);
await client.close();
