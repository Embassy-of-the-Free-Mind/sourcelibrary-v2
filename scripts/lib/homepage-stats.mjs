/**
 * The headline numbers cached in `system_config.homepage_stats` — ONE
 * computation for both writers (`scripts/maintenance/update-homepage-stats.mjs`
 * on demand, `scripts/maintenance/prewarm-browse.mjs` daily at 05:00). They used
 * to carry twin copies of every filter, kept in sync by "Keep in sync" comments.
 *
 * PRIOR ART: scripts/maintenance/update-homepage-stats.mjs + prewarm-browse.mjs — the two
 * inline twins this module replaces (#5286); no shared stats module existed in scripts/lib.
 *
 * `readableInEnglish` is the named view `readable_in_english`
 * (.claude/docs/translation-state.md § Named views), read from the stored
 * `books.translation_state` that sync-worker stamps. `translatedToEnglish` holds
 * the SAME value for one release so readers not yet switched (the broadcast
 * email, step 5 of #3402) keep working; remove it after that.
 */
import { countDistinctLanguages } from './language-count.mjs';
import { countFirstTranslatedWorks } from './contents-works.mjs';
import { READABLE_IN_ENGLISH_FILTER, translationStateStampCoverage } from './page-counts.mjs';

/** The live-book filter every public headline uses (visibility-and-stats.md). */
export const LIVE_BOOK_FILTER = Object.freeze({ visible: true, pages_count: { $gt: 0 } });

/**
 * Compute the stats document. When fewer than 99% of live books carry a
 * stamped `translation_state`, the two readable keys are LEFT OUT (the caller
 * `$set`s the rest, so the previous value stands) rather than publishing a
 * count with a hole in it — the view returned 0 the morning step 1 merged.
 */
export async function computeHomepageStats(db, { log = console } = {}) {
  const books = db.collection('books');
  const filter = { ...LIVE_BOOK_FILTER };
  const translatedFilter = { ...filter, pages_translated: { $gt: 0 } };
  // Visual artworks: single-object entries (paintings, prints, sculptures, etc.).
  // Tagged content_type:'artwork' at import. They have 0 pages (image + metadata)
  // or a few non-sequential images of the same object — not read like books.
  // resource_type is too narrow: it omits sculpture, religious art, allegory, etc.
  const artworkFilter = { visible: true, content_type: 'artwork' };

  const [stampCoverage, totalBooks, readableInEnglish, firstTranslationCount, authorCount, languageCount, artworkCount, illustrationCount, verificationReadable, verificationChecked] = await Promise.all([
    translationStateStampCoverage(books, filter),
    books.countDocuments(filter),
    books.countDocuments({ ...filter, ...READABLE_IN_ENGLISH_FILTER }),
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
  // first_translation_attempts ledger.
  const attempts = db.collection('first_translation_attempts');
  const census_ledger = {
    attempts: await attempts.estimatedDocumentCount(),
    booksSearched: (await attempts.distinct('book_id', { 'queries.0': { $exists: true } })).length,
  };

  const stats = { totalBooks, firstTranslationCount, firstTranslatedWorks, firstTranslatedWorksProvisional, authorCount, languageCount, artworkCount, illustrationCount, verification_coverage, census_ledger, updatedAt: new Date() };
  if (stampCoverage.ok) {
    stats.readableInEnglish = readableInEnglish;
    stats.translatedToEnglish = readableInEnglish; // alias for one release (#5286)
    // `updatedAt` moves on every run; this moves only when the view was published,
    // so a value held back by the stamp-coverage check is visibly stale.
    stats.readableInEnglishAt = stats.updatedAt;
  } else {
    log.warn(`readableInEnglish NOT written: only ${stampCoverage.stamped}/${stampCoverage.total} live books carry translation_state (${(100 * stampCoverage.share).toFixed(1)}% < 99%) — sync-worker has not finished stamping; previous value kept.`);
  }
  return stats;
}

/** Compute and `$set` the stats document; returns what was written. */
export async function writeHomepageStats(db, opts) {
  const stats = await computeHomepageStats(db, opts);
  await db.collection('system_config').updateOne(
    { _id: 'homepage_stats' },
    { $set: stats },
    { upsert: true },
  );
  return stats;
}
