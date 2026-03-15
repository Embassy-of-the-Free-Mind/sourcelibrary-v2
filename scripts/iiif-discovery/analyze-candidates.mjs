#!/usr/bin/env node
/**
 * Candidate Analysis — pre-import dedup, prioritization, and cost estimation.
 *
 * Runs against import_candidates to:
 * 1. Flag duplicates (exact manifest match + fuzzy title/author)
 * 2. Score priority (language, date, page count)
 * 3. Estimate processing costs
 * 4. Generate import plan with tiers
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/iiif-discovery/analyze-candidates.mjs
 *
 * Options:
 *   --source=erara         Analyze specific source only
 *   --mark-dupes           Actually mark dupes as 'skipped' in the collection
 */

import { withMongo } from '../lib/mongo.mjs';

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [key, val] = a.slice(2).split('=');
      return [key, val ?? true];
    })
);

const SOURCE = args.source || null;
const MARK_DUPES = 'mark-dupes' in args;

// Cost per page estimates (based on actual Gemini API costs from production)
const COST_PER_PAGE_OCR = 0.004;         // ~$0.004/page OCR
const COST_PER_PAGE_TRANSLATION = 0.005; // ~$0.005/page translation
const COST_PER_BOOK_METADATA = 0.02;     // summary, index, chapters
const AVG_PAGES_PER_BOOK = 250;          // conservative estimate when page_count unknown

// Language priority (matches processing-priority.ts)
const LANGUAGE_PRIORITY = {
  'Latin': 'A', 'Greek': 'A', 'Hebrew': 'A', 'Arabic': 'A', 'Aramaic': 'A',
  'German': 'B', 'French': 'B', 'Italian': 'B', 'Spanish': 'B', 'Dutch': 'B',
  'English': 'C', 'Unknown': 'B',
};

function getLanguageTier(lang) {
  return LANGUAGE_PRIORITY[lang] || 'B';
}

function getDateTier(earliest) {
  if (!earliest) return 'unknown';
  if (earliest <= 1500) return 'medieval';     // Pre-1500: manuscripts, incunabula
  if (earliest <= 1600) return 'renaissance';  // 1500-1600: golden age
  if (earliest <= 1700) return 'early-modern'; // 1600-1700: scientific revolution
  if (earliest <= 1800) return 'enlightenment'; // 1700-1800: enlightenment
  return 'post-1800';
}

await withMongo(async (db) => {
  const candidateFilter = SOURCE ? { source: SOURCE } : {};
  const candidates = db.collection('import_candidates');
  const books = db.collection('books');

  const totalCandidates = await candidates.countDocuments(candidateFilter);
  const discoveredCandidates = await candidates.countDocuments({ ...candidateFilter, status: 'discovered' });

  console.log(`\n=== Candidate Analysis ===`);
  console.log(`Source: ${SOURCE || 'all'}`);
  console.log(`Total candidates: ${totalCandidates.toLocaleString()}`);
  console.log(`Discovered (unprocessed): ${discoveredCandidates.toLocaleString()}\n`);

  // ── Step 1: Dedup Check ──────────────────────────────────────────────

  console.log('--- Dedup Analysis ---\n');

  // 1a. Exact manifest URL matches with existing books
  const existingManifests = await books.distinct('image_source.iiif_manifest', { hidden: { $ne: true } });
  const manifestSet = new Set(existingManifests.filter(Boolean));

  // 1b. Check candidates against existing books by manifest URL
  let manifestDupes = 0;
  const manifestDupeCursor = candidates.find({
    ...candidateFilter,
    status: 'discovered',
    manifest_url: { $in: [...manifestSet] },
  });
  for await (const dupe of manifestDupeCursor) {
    manifestDupes++;
    if (MARK_DUPES) {
      await candidates.updateOne(
        { _id: dupe._id },
        { $set: { status: 'skipped', skip_reason: 'Manifest already in books collection' } }
      );
    }
  }
  console.log(`  Manifest URL dupes (exact): ${manifestDupes.toLocaleString()}`);

  // 1c. Fuzzy title/author dedup — build normalized index from existing books
  const existingBooks = await books.find(
    { hidden: { $ne: true }, normalized_title: { $exists: true } },
    { projection: { normalized_title: 1, normalized_author: 1, id: 1 } }
  ).toArray();

  const titleAuthorSet = new Set(
    existingBooks.map(b => `${b.normalized_title}|||${b.normalized_author}`)
  );

  // Check candidates
  let titleDupes = 0;
  const titleDupeCursor = candidates.find({
    ...candidateFilter,
    status: 'discovered',
  }, { projection: { title: 1, author: 1, manifest_url: 1 } });

  for await (const cand of titleDupeCursor) {
    const normTitle = normalizeForDedup(cand.title);
    const normAuthor = normalizeForDedup(cand.author);
    if (normTitle.length >= 5 && titleAuthorSet.has(`${normTitle}|||${normAuthor}`)) {
      titleDupes++;
      if (MARK_DUPES) {
        await candidates.updateOne(
          { _id: cand._id },
          { $set: { status: 'skipped', skip_reason: 'Title/author match in existing books' } }
        );
      }
    }
  }
  console.log(`  Title/author dupes (fuzzy): ${titleDupes.toLocaleString()}`);

  // 1d. Cross-source dupes within candidates
  const crossSourceDupes = await candidates.aggregate([
    { $match: { ...candidateFilter, status: 'discovered' } },
    { $group: { _id: '$manifest_url', count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $count: 'total' },
  ]).toArray();
  const crossDupeCount = crossSourceDupes[0]?.total || 0;
  console.log(`  Cross-source dupes (same manifest from multiple sources): ${crossDupeCount}`);

  const totalDupes = manifestDupes + titleDupes;
  const uniqueCandidates = discoveredCandidates - totalDupes;
  console.log(`\n  Unique new candidates: ${uniqueCandidates.toLocaleString()}`);

  // ── Step 2: Language Distribution ─────────────────────────────────────

  console.log('\n--- Language Distribution ---\n');

  const langDist = await candidates.aggregate([
    { $match: { ...candidateFilter, status: 'discovered' } },
    { $group: { _id: '$language', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]).toArray();

  const langTiers = { A: 0, B: 0, C: 0 };
  for (const { _id: lang, count } of langDist) {
    const tier = getLanguageTier(lang);
    langTiers[tier] += count;
    if (count >= 100) {
      console.log(`  ${(lang || 'Unknown').padEnd(15)} ${count.toLocaleString().padStart(8)}  (Tier ${tier})`);
    }
  }
  console.log(`\n  Tier A (Latin/Greek/Hebrew/Arabic): ${langTiers.A.toLocaleString()}`);
  console.log(`  Tier B (German/French/Italian/etc): ${langTiers.B.toLocaleString()}`);
  console.log(`  Tier C (English — OCR only):        ${langTiers.C.toLocaleString()}`);

  // ── Step 3: Date Distribution ─────────────────────────────────────────

  console.log('\n--- Date Distribution ---\n');

  const dateDist = await candidates.aggregate([
    { $match: { ...candidateFilter, status: 'discovered', date_earliest: { $ne: null } } },
    {
      $bucket: {
        groupBy: '$date_earliest',
        boundaries: [0, 1400, 1500, 1600, 1700, 1800, 1900, 2100],
        default: 'unknown',
        output: { count: { $sum: 1 } },
      },
    },
  ]).toArray();

  const dateLabels = {
    0: 'Before 1400',
    1400: '1400-1499 (incunabula)',
    1500: '1500-1599 (Renaissance)',
    1600: '1600-1699 (Early Modern)',
    1700: '1700-1799 (Enlightenment)',
    1800: '1800-1899 (post-scope)',
    1900: '1900+ (modern)',
    'unknown': 'Unknown date',
  };

  let preScopeTotal = 0;
  let postScopeTotal = 0;
  for (const bucket of dateDist) {
    const label = dateLabels[bucket._id] || `${bucket._id}`;
    console.log(`  ${label.padEnd(35)} ${bucket.count.toLocaleString().padStart(8)}`);
    if (bucket._id < 1800 || bucket._id === 0) preScopeTotal += bucket.count;
    else postScopeTotal += bucket.count;
  }

  const unknownDate = await candidates.countDocuments({
    ...candidateFilter, status: 'discovered', date_earliest: null,
  });
  console.log(`  ${'Unknown date'.padEnd(35)} ${unknownDate.toLocaleString().padStart(8)}`);

  console.log(`\n  In scope (pre-1800): ${preScopeTotal.toLocaleString()}`);
  console.log(`  Out of scope (post-1800): ${postScopeTotal.toLocaleString()}`);
  console.log(`  Unknown: ${unknownDate.toLocaleString()}`);

  // ── Step 4: Cost Estimation ───────────────────────────────────────────

  console.log('\n--- Cost Estimation ---\n');

  // Get page counts where available
  const pageStats = await candidates.aggregate([
    { $match: { ...candidateFilter, status: 'discovered', page_count: { $ne: null, $gt: 0 } } },
    {
      $group: {
        _id: null,
        totalPages: { $sum: '$page_count' },
        avgPages: { $avg: '$page_count' },
        count: { $sum: 1 },
      },
    },
  ]).toArray();

  const knownPages = pageStats[0]?.totalPages || 0;
  const avgPages = pageStats[0]?.avgPages || AVG_PAGES_PER_BOOK;
  const knownCount = pageStats[0]?.count || 0;
  const unknownPageCount = uniqueCandidates - knownCount;
  const estimatedPages = knownPages + (unknownPageCount * AVG_PAGES_PER_BOOK);

  console.log(`  Books with known page counts: ${knownCount.toLocaleString()} (${knownPages.toLocaleString()} pages, avg ${Math.round(avgPages)})`);
  console.log(`  Books without page counts: ${unknownPageCount.toLocaleString()} (est. ${AVG_PAGES_PER_BOOK} pages each)`);
  console.log(`  Total estimated pages: ${estimatedPages.toLocaleString()}`);

  const ocrCost = estimatedPages * COST_PER_PAGE_OCR;
  const translationCost = estimatedPages * COST_PER_PAGE_TRANSLATION;
  const metadataCost = uniqueCandidates * COST_PER_BOOK_METADATA;
  const totalAICost = ocrCost + translationCost + metadataCost;

  console.log(`\n  OCR cost:         $${ocrCost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`);
  console.log(`  Translation cost: $${translationCost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`);
  console.log(`  Metadata cost:    $${metadataCost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`);
  console.log(`  Total AI cost:    $${totalAICost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`);
  console.log(`  Cost per book:    $${(totalAICost / uniqueCandidates).toFixed(2)}`);

  // MongoDB storage estimate
  const mongoImportGB = (uniqueCandidates * 0.003 + estimatedPages * 0.00075) / 1; // book docs + page docs (MB → GB)
  const mongoProcessedGB = estimatedPages * 0.012 / 1000; // 12KB per processed page
  console.log(`\n  MongoDB (import only): ~${mongoImportGB.toFixed(1)} MB`);
  console.log(`  MongoDB (fully processed): ~${mongoProcessedGB.toFixed(0)} GB`);
  console.log(`  Vercel Blob (IIIF, no archiving): $0`);

  // ── Step 5: Import Plan ───────────────────────────────────────────────

  console.log('\n--- Suggested Import Plan ---\n');

  // Tier 1: Latin/Greek/Hebrew pre-1600 books — the core mission
  const tier1 = await candidates.countDocuments({
    ...candidateFilter,
    status: 'discovered',
    language: { $in: ['Latin', 'Greek', 'Hebrew', 'Arabic', 'Aramaic'] },
    $or: [
      { date_earliest: { $lte: 1600 } },
      { date_earliest: null },
    ],
  });

  // Tier 2: Latin/Greek 1600-1800 + vernacular pre-1600
  const tier2 = await candidates.countDocuments({
    ...candidateFilter,
    status: 'discovered',
    $or: [
      { language: { $in: ['Latin', 'Greek', 'Hebrew', 'Arabic'] }, date_earliest: { $gt: 1600, $lte: 1800 } },
      { language: { $in: ['German', 'French', 'Italian', 'Spanish', 'Dutch'] }, date_earliest: { $lte: 1600 } },
    ],
  });

  // Tier 3: Everything else pre-1800
  const tier3 = await candidates.countDocuments({
    ...candidateFilter,
    status: 'discovered',
    date_earliest: { $lte: 1800, $ne: null },
  }) - tier1 - tier2;

  const tier1Cost = tier1 * (AVG_PAGES_PER_BOOK * (COST_PER_PAGE_OCR + COST_PER_PAGE_TRANSLATION) + COST_PER_BOOK_METADATA);
  const tier2Cost = tier2 * (AVG_PAGES_PER_BOOK * (COST_PER_PAGE_OCR + COST_PER_PAGE_TRANSLATION) + COST_PER_BOOK_METADATA);
  const tier3Cost = Math.max(0, tier3) * (AVG_PAGES_PER_BOOK * (COST_PER_PAGE_OCR + COST_PER_PAGE_TRANSLATION) + COST_PER_BOOK_METADATA);

  console.log(`  Tier 1 — Classical languages, pre-1600 (core mission)`);
  console.log(`    Books: ${tier1.toLocaleString()} | Est. cost: $${tier1Cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  console.log(`  Tier 2 — Classical 1600-1800 + vernacular pre-1600`);
  console.log(`    Books: ${tier2.toLocaleString()} | Est. cost: $${tier2Cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  console.log(`  Tier 3 — Everything else pre-1800`);
  console.log(`    Books: ${Math.max(0, tier3).toLocaleString()} | Est. cost: $${tier3Cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);

  console.log(`\n  Import all tiers (no processing): FREE — takes ~${Math.ceil(uniqueCandidates / 1800)} hours`);
  console.log(`  Process Tier 1 only: $${tier1Cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  console.log(`  Process Tiers 1+2: $${(tier1Cost + tier2Cost).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
  console.log(`  Process all: $${totalAICost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);

}, { noTimeout: true });

function normalizeForDedup(str) {
  return (str || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^(the|a|an|der|die|das|de|le|la|les|il|lo|gli|i|el|los|las)\s+/i, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
