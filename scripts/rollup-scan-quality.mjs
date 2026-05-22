#!/usr/bin/env node
/**
 * Roll up page-level scan_quality (v2) into book.scan_quality across the corpus.
 * Use this for the one-shot backfill on books whose pages were scored by an
 * earlier image-extract-worker run that didn't yet do inline rollup, and for
 * targeted re-rollups when individual books need refreshing.
 *
 * The inline rollup in image-extract-worker.mjs handles the forward path
 * (every book the worker touches gets rolled up at completion). This script
 * is the catch-up tool.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/rollup-scan-quality.mjs [opts]
 *
 * Options:
 *   --book ID           Roll up a single book by id
 *   --all               Roll up every book that has v2 pages
 *   --since YYYY-MM-DD  Roll up books with v2 pages updated since this date
 *   --limit N           Cap to first N books in the candidate set
 *   --dry-run           Compute rollups but do NOT write to Mongo
 *   --concurrency N     Parallel rollups (default 8)
 *
 * Exit non-zero if no candidate set is selected.
 */

import { MongoClient } from 'mongodb';

// Accept both --flag=value and --flag value forms.
const flags = {};
const argv = process.argv.slice(2);
const valueExpected = new Set(['book', 'since', 'limit', 'concurrency']);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) continue;
  const [rawK, rawV] = a.replace(/^--/, '').split('=');
  if (rawV !== undefined) {
    flags[rawK] = rawV;
  } else if (valueExpected.has(rawK) && argv[i + 1] && !argv[i + 1].startsWith('--')) {
    flags[rawK] = argv[++i];
  } else {
    flags[rawK] = true;
  }
}
if (flags.book && flags.all) {
  console.error('Choose --book OR --all, not both'); process.exit(1);
}
if (!flags.book && !flags.all && !flags.since) {
  console.error('Pass --book ID, --all, or --since YYYY-MM-DD'); process.exit(1);
}

const DRY = !!flags['dry-run'];
const CONCURRENCY = parseInt(flags.concurrency, 10) || 8;
const LIMIT = flags.limit ? parseInt(flags.limit, 10) : 0;

const SCAN_QUALITY_VERSION = 2;

const CONTENT_SCAN_CLASSES = new Set([
  'color_photo', 'color_print',
  'grayscale_photo', 'grayscale_print',
  'bitonal_clean', 'bitonal_microfilm', 'microfiche',
]);

function legacyClassificationFor(dominantClass) {
  if (['bitonal_clean', 'bitonal_microfilm', 'microfiche'].includes(dominantClass)) return 'bw';
  if (['grayscale_photo', 'grayscale_print'].includes(dominantClass)) return 'grayscale';
  if (['color_photo', 'color_print'].includes(dominantClass)) return 'color';
  return null;
}

async function computeRollup(db, bookId) {
  const pages = await db.collection('pages').find(
    { book_id: bookId, 'scan_quality.version': 2 },
    {
      projection: {
        id: 1, page_number: 1,
        'scan_quality.scan_score': 1,
        'scan_quality.scan_class': 1,
        'scan_quality.page_completeness': 1,
        'scan_quality.concerns': 1,
        'scan_quality.illustration_fidelity': 1,
        'scan_quality.class_corrected': 1,
      },
    },
  ).toArray();

  if (pages.length === 0) return null;

  const scores = pages
    .map(p => p.scan_quality?.scan_score)
    .filter(s => typeof s === 'number')
    .sort((a, b) => a - b);
  if (scores.length === 0) return null;

  const median = scores[Math.floor(scores.length / 2)];
  const min = scores[0];
  const max = scores[scores.length - 1];

  const classCounts = {};
  const concernCounts = {};
  let classCorrectedCount = 0;
  let completenessIssues = 0;
  for (const p of pages) {
    const sq = p.scan_quality;
    if (!sq) continue;
    if (sq.scan_class) classCounts[sq.scan_class] = (classCounts[sq.scan_class] || 0) + 1;
    for (const c of (sq.concerns || [])) concernCounts[c] = (concernCounts[c] || 0) + 1;
    if (sq.class_corrected) classCorrectedCount++;
    if (sq.page_completeness && sq.page_completeness !== 'full_page') completenessIssues++;
  }

  const classEntries = Object.entries(classCounts).sort((a, b) => b[1] - a[1]);
  const dominantClass = classEntries[0]?.[0] || null;

  const contentPages = pages
    .filter(p => CONTENT_SCAN_CLASSES.has(p.scan_quality?.scan_class))
    .filter(p => typeof p.scan_quality?.scan_score === 'number')
    .sort((a, b) => a.scan_quality.scan_score - b.scan_quality.scan_score);
  const worstImage = contentPages[0] ? {
    page_id: contentPages[0].id,
    page_number: contentPages[0].page_number,
    scan_score: contentPages[0].scan_quality.scan_score,
    scan_class: contentPages[0].scan_quality.scan_class,
    concerns: contentPages[0].scan_quality.concerns || [],
  } : null;
  const bestImage = contentPages.length ? {
    page_id: contentPages[contentPages.length - 1].id,
    page_number: contentPages[contentPages.length - 1].page_number,
    scan_score: contentPages[contentPages.length - 1].scan_quality.scan_score,
    scan_class: contentPages[contentPages.length - 1].scan_quality.scan_class,
  } : null;

  return {
    score: median,
    classification: legacyClassificationFor(dominantClass),
    median_score: median,
    min_score: min,
    max_score: max,
    pages_assessed: pages.length,
    content_pages_assessed: contentPages.length,
    dominant_scan_class: dominantClass,
    class_distribution: classCounts,
    concerns_distribution: concernCounts,
    has_microfilm_pages: !!(classCounts.bitonal_microfilm || classCounts.microfiche),
    has_blank_pages: !!classCounts.blank,
    has_scanner_metadata_pages: !!classCounts.scanner_metadata,
    has_corrupt_pages: !!classCounts.corrupt,
    completeness_issues_count: completenessIssues,
    class_corrected_count: classCorrectedCount,
    worst_image: worstImage,
    best_image: bestImage,
    rollup_at: new Date(),
    version: SCAN_QUALITY_VERSION,
  };
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000, maxPoolSize: 6 });
  await client.connect();
  const db = client.db('bookstore');

  let candidateIds;

  if (flags.book) {
    candidateIds = [flags.book];
  } else if (flags.all) {
    // Books that have at least one page with scan_quality.version = 2
    candidateIds = await db.collection('pages').distinct('book_id', { 'scan_quality.version': 2 });
  } else if (flags.since) {
    const since = new Date(flags.since);
    if (isNaN(since.getTime())) { console.error('Invalid --since date:', flags.since); process.exit(1); }
    const ids = await db.collection('pages').distinct('book_id', {
      'scan_quality.version': 2,
      'scan_quality.assessed_at': { $gte: since },
    });
    candidateIds = ids;
  }

  if (LIMIT > 0) candidateIds = candidateIds.slice(0, LIMIT);
  console.log(`Candidate books: ${candidateIds.length}${DRY ? ' (DRY RUN — no writes)' : ''}`);

  if (candidateIds.length === 0) {
    await client.close();
    return;
  }

  let processed = 0;
  let withRollup = 0;
  let writes = 0;
  let errors = 0;
  const classDist = {};

  for (let i = 0; i < candidateIds.length; i += CONCURRENCY) {
    const chunk = candidateIds.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(chunk.map(async (id) => {
      const rollup = await computeRollup(db, id);
      if (!rollup) return { id, skip: true };
      if (!DRY) {
        await db.collection('books').updateOne({ id }, { $set: { scan_quality: rollup, updated_at: new Date() } });
      }
      return { id, rollup };
    }));
    for (const r of results) {
      processed++;
      if (r.status === 'rejected') { errors++; console.error('  err:', r.reason?.message); continue; }
      if (r.value.skip) continue;
      withRollup++;
      if (!DRY) writes++;
      const dc = r.value.rollup.dominant_scan_class;
      classDist[dc] = (classDist[dc] || 0) + 1;
    }
    if (processed % (CONCURRENCY * 10) === 0 || processed === candidateIds.length) {
      process.stdout.write(`\r  ${processed}/${candidateIds.length}  with-rollup=${withRollup}  written=${writes}  errors=${errors}`);
    }
  }
  process.stdout.write('\n');

  console.log('\n=== SUMMARY ===');
  console.log(`processed:        ${processed}`);
  console.log(`with rollup:      ${withRollup}`);
  console.log(`written:          ${writes}${DRY ? ' (DRY RUN)' : ''}`);
  console.log(`errors:           ${errors}`);
  console.log('dominant_scan_class distribution:');
  for (const [c, n] of Object.entries(classDist).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c.padEnd(20)} ${n}`);
  }

  await client.close();
}

main().catch(e => { console.error('fatal:', e); process.exit(1); });
