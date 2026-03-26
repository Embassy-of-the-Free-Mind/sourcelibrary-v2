#!/usr/bin/env node
/**
 * Core Source Library Stats
 *
 * Computes the canonical stats used in press releases, the homepage,
 * and progress reports. All queries use the books collection (fast)
 * rather than the pages collection (slow).
 *
 * Run:
 *   set -a; source .env.production.local; set +a; node scripts/analysis/get-stats.mjs
 *   set -a; source .env.production.local; set +a; node scripts/analysis/get-stats.mjs --json
 *
 * Stats definitions:
 *   visible_books       — books where hidden != true
 *   languages           — distinct base languages (after deduplicating bilingual combos)
 *   books_with_translation — visible books with pages_translated > 0
 *   fully_translated    — visible books where pages_translated >= 90% of pages_count
 *   first_translations  — is_first_translation: true AND language != 'English'
 *   first_translations_translated — above + pages_translated > 0
 *   first_translations_complete   — above + >= 90% translated
 *   total_pages         — sum of pages_count across visible books
 *   pages_translated    — sum of pages_translated across visible books
 *   pages_ocr           — sum of pages_ocr across visible books
 *   gallery_images      — count from gallery_images collection
 *   contributing_libraries — distinct contributing_library values (non-empty)
 */

import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 180000,
  maxPoolSize: 3,
});

const VISIBLE = { hidden: { $ne: true } };
const JSON_MODE = process.argv.includes('--json');

async function main() {
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  // ── Counts (indexed, fast) ────────────────────────────────────────
  const [
    visible_books,
    books_with_translation,
    first_translations,
    first_translations_translated,
    gallery_images,
  ] = await Promise.all([
    books.countDocuments(VISIBLE),
    books.countDocuments({ ...VISIBLE, pages_translated: { $gt: 0 } }),
    books.countDocuments({ ...VISIBLE, is_first_translation: true, language: { $ne: 'English' } }),
    books.countDocuments({ ...VISIBLE, is_first_translation: true, language: { $ne: 'English' }, pages_translated: { $gt: 0 } }),
    db.collection('gallery_images').estimatedDocumentCount(),
  ]);

  // ── Aggregations ──────────────────────────────────────────────────
  const [pageStats, fullyTranslatedArr, firstCompleteArr, langAgg, libAgg] = await Promise.all([
    books.aggregate([
      { $match: VISIBLE },
      { $group: { _id: null,
        total_pages: { $sum: '$pages_count' },
        pages_translated: { $sum: '$pages_translated' },
        pages_ocr: { $sum: '$pages_ocr' },
      }},
    ], { maxTimeMS: 120000 }).toArray(),

    books.aggregate([
      { $match: { ...VISIBLE, pages_translated: { $gt: 0 },
        $expr: { $gte: ['$pages_translated', { $multiply: ['$pages_count', 0.9] }] } } },
      { $count: 'n' },
    ], { maxTimeMS: 120000 }).toArray(),

    books.aggregate([
      { $match: { ...VISIBLE, is_first_translation: true, language: { $ne: 'English' }, pages_translated: { $gt: 0 },
        $expr: { $gte: ['$pages_translated', { $multiply: ['$pages_count', 0.9] }] } } },
      { $count: 'n' },
    ], { maxTimeMS: 120000 }).toArray(),

    books.aggregate([
      { $match: VISIBLE },
      { $group: { _id: '$language' } },
    ], { maxTimeMS: 120000 }).toArray(),

    books.aggregate([
      { $match: { ...VISIBLE, contributing_library: { $exists: true, $ne: null, $ne: '' } } },
      { $group: { _id: '$contributing_library' } },
      { $count: 'n' },
    ], { maxTimeMS: 120000 }).toArray(),
  ]);

  const p = pageStats[0] || {};
  const fully_translated = fullyTranslatedArr[0]?.n || 0;
  const first_translations_complete = firstCompleteArr[0]?.n || 0;
  const contributing_libraries = libAgg[0]?.n || 0;

  // Deduplicate languages: split bilingual combos, normalize
  const baseLanguages = new Set();
  for (const { _id: lang } of langAgg) {
    if (!lang || lang === 'Unknown' || lang === 'Multiple') continue;
    const parts = lang
      .replace(/[\/\-,]/g, ' ')
      .replace(/\(.*?\)/g, '')
      .replace(/ and /g, ' ')
      .replace(/ in /g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !['script', 'Hebrew', 'alphabet'].includes(w));
    for (const p of parts) {
      // Collapse historical variants
      if (['Ancient', 'Middle', 'Old', 'Church'].includes(p)) continue;
      baseLanguages.add(p);
    }
  }

  const stats = {
    // ── Collection size ──
    visible_books,
    total_pages: p.total_pages || 0,
    gallery_images,
    contributing_libraries,
    languages_raw: langAgg.length,
    languages_deduplicated: baseLanguages.size,

    // ── Translation coverage ──
    books_with_translation,
    fully_translated,
    pages_ocr: p.pages_ocr || 0,
    pages_translated: p.pages_translated || 0,

    // ── First translations (excluding English originals) ──
    first_translations,
    first_translations_translated,
    first_translations_complete,

    // ── Press-friendly (rounded) ──
    press: {
      books: `${Math.floor(visible_books / 1000)}K+`,
      pages_digitized: `${(p.total_pages / 1_000_000).toFixed(1)} million`,
      pages_translated: `${(p.pages_translated / 1_000_000).toFixed(1)} million`,
      books_translated: `${Math.floor(books_with_translation / 100) * 100}+`,
      fully_translated: `${Math.floor(fully_translated / 100) * 100}+`,
      first_translations_complete: `${Math.floor(first_translations_complete / 100) * 100}+`,
      languages: `${Math.floor(baseLanguages.size / 5) * 5}+`,
      illustrations: `${Math.floor(gallery_images / 1000)}K+`,
    },
  };

  if (JSON_MODE) {
    console.log(JSON.stringify(stats, null, 2));
  } else {
    console.log('');
    console.log('SOURCE LIBRARY — CORE STATS');
    console.log('═══════════════════════════════════════════════════');
    console.log('');
    console.log('Collection');
    console.log(`  Visible books:            ${visible_books.toLocaleString()}`);
    console.log(`  Total pages:              ${p.total_pages?.toLocaleString()}`);
    console.log(`  Languages (raw/deduped):  ${langAgg.length} / ${baseLanguages.size}`);
    console.log(`  Contributing libraries:   ${contributing_libraries}`);
    console.log(`  Gallery images:           ${gallery_images.toLocaleString()}`);
    console.log('');
    console.log('Translation');
    console.log(`  Books with translation:   ${books_with_translation.toLocaleString()}`);
    console.log(`  Fully translated (>90%):  ${fully_translated.toLocaleString()}`);
    console.log(`  Pages OCR'd:             ${p.pages_ocr?.toLocaleString()}`);
    console.log(`  Pages translated:         ${p.pages_translated?.toLocaleString()}`);
    console.log('');
    console.log('First Translations (non-English)');
    console.log(`  Tagged as first:          ${first_translations.toLocaleString()}`);
    console.log(`  With any translation:     ${first_translations_translated.toLocaleString()}`);
    console.log(`  Fully translated:         ${first_translations_complete.toLocaleString()}`);
    console.log('');
    console.log('Press-Friendly');
    for (const [k, v] of Object.entries(stats.press)) {
      console.log(`  ${k.padEnd(32)} ${v}`);
    }
    console.log('');
  }

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
