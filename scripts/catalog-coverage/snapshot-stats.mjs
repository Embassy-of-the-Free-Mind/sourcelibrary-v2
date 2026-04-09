#!/usr/bin/env node
/**
 * Snapshot catalog coverage stats for historical tracking.
 *
 * Records current totals to catalog_coverage_snapshots collection.
 * Run after each rebuild to track progress over time.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/catalog-coverage/snapshot-stats.mjs
 */

import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGODB_URI;
if (!MONGO_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db('bookstore');

  const meta = await db.collection('catalog_coverage_meta').findOne({ _id: 'latest_build' });
  if (!meta) {
    console.error('No catalog_coverage_meta found. Run build.mjs first.');
    process.exit(1);
  }

  const stats = meta.stats || {};
  const totals = Object.values(stats).reduce((acc, s) => ({
    editions: acc.editions + (s.editions || 0),
    scanned: acc.scanned + (s.scans || 0),
    translated: acc.translated + (s.translations || 0),
    in_sl: acc.in_sl + (s.inSourceLibrary || 0),
    works: acc.works + (s.distinctWorks || 0),
  }), { editions: 0, scanned: 0, translated: 0, in_sl: 0, works: 0 });

  const importCount = await db.collection('import_candidates').countDocuments({ status: { $in: ['discovered', 'imported'] } });

  // Live Source Library stats
  const books = db.collection('books');
  // Avoid $expr for >90% — it requires a full collection scan.
  // Instead, use the system_config snapshot if available, or skip.
  const [slBooks, slWithPages, slTranslated, slFirstTrans, slVerified] = await Promise.all([
    books.countDocuments({}),
    books.countDocuments({ pages_count: { $gt: 0 } }),
    books.countDocuments({ pages_translated: { $gt: 0 } }),
    books.countDocuments({ is_first_translation: true }),
    books.countDocuments({ translation_verification: { $exists: true } }),
  ]);

  // Use enrichment snapshot for >90% (avoids slow $expr collection scan)
  const enrichSnap = await db.collection('system_config').findOne({ _id: 'enrichment_snapshot' });
  const slOver90 = enrichSnap?.milestones?.over_90_pct || 0;

  const snapshot = {
    date: new Date().toISOString().split('T')[0], // YYYY-MM-DD
    created_at: new Date(),
    // USTC census
    ustc_editions: totals.editions,
    distinct_works: totals.works,
    import_candidates: importCount,
    with_scan: totals.scanned,
    pct_scanned: totals.editions > 0 ? +(totals.scanned / totals.editions * 100).toFixed(2) : 0,
    with_translation: totals.translated,
    pct_translated: totals.editions > 0 ? +(totals.translated / totals.editions * 100).toFixed(2) : 0,
    in_source_library: totals.in_sl,
    // Live Source Library stats
    sl: {
      total_books: slBooks,
      books_with_pages: slWithPages,
      books_translated: slTranslated,
      books_over_90_pct: slOver90,
      first_translations: slFirstTrans,
      verified_total: slVerified,
    },
    by_language: Object.fromEntries(
      Object.entries(stats).map(([lang, s]) => [lang, {
        editions: s.editions || 0,
        scanned: s.scans || 0,
        translated: s.translations || 0,
        in_sl: s.inSourceLibrary || 0,
      }])
    ),
    build_metadata: {
      built_at: meta.built_at || meta.updatedAt,
      sources: meta.sources || [],
    },
  };

  // Use date as _id to prevent duplicate snapshots for same day
  await db.collection('catalog_coverage_snapshots').updateOne(
    { _id: snapshot.date },
    { $set: snapshot },
    { upsert: true },
  );

  console.log(`Snapshot saved for ${snapshot.date}:`);
  console.log(`  Editions: ${snapshot.ustc_editions.toLocaleString()}`);
  console.log(`  Scanned: ${snapshot.with_scan.toLocaleString()} (${snapshot.pct_scanned}%)`);
  console.log(`  Translated: ${snapshot.with_translation.toLocaleString()} (${snapshot.pct_translated}%)`);
  console.log(`  In SL (census match): ${snapshot.in_source_library.toLocaleString()}`);
  console.log(`  Import candidates: ${snapshot.import_candidates.toLocaleString()}`);
  console.log(`  --- Source Library ---`);
  console.log(`  Books with pages: ${snapshot.sl.books_with_pages.toLocaleString()}`);
  console.log(`  Books translated: ${snapshot.sl.books_translated.toLocaleString()}`);
  console.log(`  >90% translated: ${snapshot.sl.books_over_90_pct.toLocaleString()}`);
  console.log(`  First translations: ${snapshot.sl.first_translations.toLocaleString()}`);
  console.log(`  Verified: ${snapshot.sl.verified_total.toLocaleString()}`);

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
