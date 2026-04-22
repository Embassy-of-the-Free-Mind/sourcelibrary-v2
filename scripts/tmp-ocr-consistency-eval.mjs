#!/usr/bin/env node
/**
 * OCR Consistency Evaluation using edition pairs as ground truth.
 *
 * For each work_id cluster with multiple editions:
 * 1. Extract raw Latin OCR from each edition
 * 2. Align pages by content similarity (sliding window)
 * 3. Compare aligned passages character-by-character
 * 4. Classify differences: OCR error vs abbreviation variant vs edition change
 * 5. Where OCR matches, compare translations to measure Gemini stability
 *
 * Output: per-cluster and aggregate quality metrics
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';

// ── Text extraction ────────────────────────────────────────────────
function extractLatinText(ocrData) {
  if (!ocrData) return '';
  return ocrData
    .replace(/<[^>]*>/g, '')           // strip XML tags
    .replace(/\[\[[^\]]*\]\]/g, '')    // strip [[metadata]]
    .replace(/^#+\s*/gm, '')           // strip markdown headers
    .replace(/\*\*/g, '')              // strip bold markers
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTranslation(translationData) {
  if (!translationData) return '';
  return translationData
    .replace(/<[^>]*>/g, '')
    .replace(/\[\[[^\]]*\]\]/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Similarity ─────────────────────────────────────────────────────
function trigrams(s) {
  const p = '  ' + s.toLowerCase() + '  ';
  const set = new Set();
  for (let i = 0; i < p.length - 2; i++) set.add(p.slice(i, i + 3));
  return set;
}

function triSim(a, b) {
  if (!a || !b || a.length < 30 || b.length < 30) return 0;
  const ta = trigrams(a), tb = trigrams(b);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

// ── Word-level diff ────────────────────────────────────────────────
function wordDiff(a, b) {
  const wa = a.split(/\s+/);
  const wb = b.split(/\s+/);
  const len = Math.min(wa.length, wb.length);
  let matches = 0;
  let substitutions = 0;
  const diffs = [];

  for (let i = 0; i < len; i++) {
    if (wa[i].toLowerCase() === wb[i].toLowerCase()) {
      matches++;
    } else {
      substitutions++;
      if (diffs.length < 10) {
        diffs.push({ pos: i, a: wa[i], b: wb[i], type: classifyDiff(wa[i], wb[i]) });
      }
    }
  }

  const lengthDiff = Math.abs(wa.length - wb.length);
  return { matches, substitutions, lengthDiff, total: len, diffs };
}

// ── Classify individual word differences ───────────────────────────
function classifyDiff(a, b) {
  const la = a.toLowerCase().replace(/[.,;:!?()]/g, '');
  const lb = b.toLowerCase().replace(/[.,;:!?()]/g, '');

  if (la === lb) return 'punctuation';

  // Abbreviation expansion: ã→am, q̃→que, ē→est, etc.
  const abbrevPatterns = [
    [/[ãā]/g, 'am'], [/[ẽē]/g, 'e'], [/[q̃q̄]/g, 'que'],
    [/[ō]/g, 'on'], [/[ū]/g, 'um'], [/[ñ]/g, 'n'],
  ];
  let expandedA = la, expandedB = lb;
  for (const [pat, rep] of abbrevPatterns) {
    expandedA = expandedA.replace(pat, rep);
    expandedB = expandedB.replace(pat, rep);
  }
  if (expandedA === expandedB) return 'abbreviation';

  // Spelling variant: ae/e, ti/ci, u/v, i/j
  const normalized = s => s
    .replace(/ae/g, 'e').replace(/oe/g, 'e')
    .replace(/ti([aeiou])/g, 'ci$1')
    .replace(/v/g, 'u').replace(/j/g, 'i')
    .replace(/y/g, 'i');
  if (normalized(la) === normalized(lb)) return 'spelling_variant';

  // Edit distance check — small edits likely OCR errors
  const editDist = levenshtein(la, lb);
  const maxLen = Math.max(la.length, lb.length);
  if (maxLen > 0 && editDist / maxLen <= 0.3) return 'ocr_error_likely';

  return 'major_difference';
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

// ── Main ───────────────────────────────────────────────────────────
async function main() {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  // Find all work_id clusters with 2+ editions
  const clusters = await db.collection('books').aggregate([
    { $match: { status: 'published', work_id: { $exists: true, $ne: null } } },
    { $group: {
      _id: '$work_id',
      books: { $push: { id: '$id', title: '$title', pages_translated: '$pages_translated', pages_ocr: '$pages_ocr' } }
    }},
    { $match: { 'books.1': { $exists: true } } },
    { $sort: { _id: 1 } }
  ]).toArray();

  console.log(`Found ${clusters.length} edition clusters\n`);

  const globalStats = {
    clustersEvaluated: 0,
    pairsAligned: 0,
    totalWords: 0,
    wordMatches: 0,
    punctuationDiffs: 0,
    abbreviationDiffs: 0,
    spellingDiffs: 0,
    ocrErrors: 0,
    majorDiffs: 0,
    translationPairs: 0,
    translationSimSum: 0,
    exampleDiffs: [],
  };

  for (const cluster of clusters) {
    // Pick the two editions with the most OCR pages
    const sorted = cluster.books
      .filter(b => (b.pages_ocr || 0) > 10)
      .sort((a, b) => (b.pages_ocr || 0) - (a.pages_ocr || 0));

    if (sorted.length < 2) continue;

    const [edA, edB] = [sorted[0], sorted[1]];

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`${cluster._id}`);
    console.log(`  A: "${edA.title}" (${edA.pages_ocr}pp OCR)`);
    console.log(`  B: "${edB.title}" (${edB.pages_ocr}pp OCR)`);

    // Load all OCR pages for both editions
    const pagesA = await db.collection('pages').find(
      { book_id: edA.id, 'ocr.data': { $exists: true, $ne: null } },
      { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1 } }
    ).sort({ page_number: 1 }).toArray();

    const pagesB = await db.collection('pages').find(
      { book_id: edB.id, 'ocr.data': { $exists: true, $ne: null } },
      { projection: { page_number: 1, 'ocr.data': 1, 'translation.data': 1 } }
    ).sort({ page_number: 1 }).toArray();

    // Extract Latin text from each page, filter to real content (>100 chars)
    const textsA = pagesA
      .map(p => ({ page: p.page_number, ocr: extractLatinText(p.ocr.data), translation: extractTranslation(p.translation?.data) }))
      .filter(p => p.ocr.length > 100);

    const textsB = pagesB
      .map(p => ({ page: p.page_number, ocr: extractLatinText(p.ocr.data), translation: extractTranslation(p.translation?.data) }))
      .filter(p => p.ocr.length > 100);

    if (textsA.length < 5 || textsB.length < 5) {
      console.log(`  Skipped — too few content pages (A:${textsA.length} B:${textsB.length})`);
      continue;
    }

    // Align pages: for each page in A (sampled), find best match in B
    const sampleSize = Math.min(20, textsA.length);
    const step = Math.max(1, Math.floor(textsA.length / sampleSize));
    let alignedCount = 0;
    const clusterDiffs = { punctuation: 0, abbreviation: 0, spelling: 0, ocr: 0, major: 0, words: 0, matches: 0 };

    for (let i = 0; i < textsA.length && alignedCount < sampleSize; i += step) {
      const pageA = textsA[i];
      const chunkA = pageA.ocr.substring(0, 400);

      // Find best matching page in B
      let bestSim = 0, bestIdx = -1;
      for (let j = 0; j < textsB.length; j++) {
        const sim = triSim(chunkA, textsB[j].ocr.substring(0, 400));
        if (sim > bestSim) { bestSim = sim; bestIdx = j; }
      }

      if (bestSim < 0.25 || bestIdx < 0) continue; // no alignment found

      const pageB = textsB[bestIdx];
      alignedCount++;
      globalStats.pairsAligned++;

      // Word-level diff on aligned passages
      const diff = wordDiff(
        pageA.ocr.substring(0, 500),
        pageB.ocr.substring(0, 500)
      );

      clusterDiffs.words += diff.total;
      clusterDiffs.matches += diff.matches;
      for (const d of diff.diffs) {
        clusterDiffs[d.type === 'punctuation' ? 'punctuation' :
          d.type === 'abbreviation' ? 'abbreviation' :
          d.type === 'spelling_variant' ? 'spelling' :
          d.type === 'ocr_error_likely' ? 'ocr' : 'major']++;
      }

      globalStats.totalWords += diff.total;
      globalStats.wordMatches += diff.matches;

      // Show interesting aligned pairs
      if (bestSim > 0.4 && alignedCount <= 3) {
        console.log(`\n  Aligned: A p${pageA.page} ↔ B p${pageB.page} (OCR sim ${bestSim.toFixed(3)})`);
        console.log(`    A: ${pageA.ocr.substring(0, 150)}...`);
        console.log(`    B: ${pageB.ocr.substring(0, 150)}...`);
        console.log(`    Words: ${diff.matches}/${diff.total} match (${(100*diff.matches/diff.total).toFixed(0)}%)`);
        for (const d of diff.diffs.slice(0, 3)) {
          console.log(`      ${d.type}: "${d.a}" → "${d.b}"`);
          if (globalStats.exampleDiffs.length < 30) {
            globalStats.exampleDiffs.push({ cluster: cluster._id, ...d });
          }
        }
      }

      // Compare translations where OCR is similar
      if (bestSim > 0.4 && pageA.translation?.length > 100 && pageB.translation?.length > 100) {
        const trA = pageA.translation.substring(0, 500);
        const trB = pageB.translation.substring(0, 500);
        // Skip meta-descriptions
        if (!trA.startsWith('This page') && !trB.startsWith('This page')) {
          const trSim = triSim(trA, trB);
          globalStats.translationPairs++;
          globalStats.translationSimSum += trSim;
        }
      }
    }

    // Accumulate diff type counts
    for (const d of diff_keys) {
      globalStats[d === 'punctuation' ? 'punctuationDiffs' :
        d === 'abbreviation' ? 'abbreviationDiffs' :
        d === 'spelling' ? 'spellingDiffs' :
        d === 'ocr' ? 'ocrErrors' : 'majorDiffs'] += clusterDiffs[d];
    }

    const accuracy = clusterDiffs.words > 0 ? (100 * clusterDiffs.matches / clusterDiffs.words).toFixed(1) : 'N/A';
    console.log(`\n  Summary: ${alignedCount} pages aligned, word accuracy ${accuracy}%`);
    console.log(`    Diffs: punct=${clusterDiffs.punctuation} abbrev=${clusterDiffs.abbreviation} spelling=${clusterDiffs.spelling} OCR=${clusterDiffs.ocr} major=${clusterDiffs.major}`);

    globalStats.clustersEvaluated++;
  }

  // Global report
  console.log(`\n${'═'.repeat(60)}`);
  console.log('GLOBAL OCR CONSISTENCY REPORT');
  console.log(`${'═'.repeat(60)}`);
  console.log(`Clusters evaluated: ${globalStats.clustersEvaluated}`);
  console.log(`Page pairs aligned: ${globalStats.pairsAligned}`);
  console.log(`Total words compared: ${globalStats.totalWords.toLocaleString()}`);
  console.log(`Word-level accuracy: ${(100 * globalStats.wordMatches / globalStats.totalWords).toFixed(1)}%`);
  console.log();
  console.log('Difference breakdown:');
  const totalDiffs = globalStats.totalWords - globalStats.wordMatches;
  console.log(`  Punctuation:       ${globalStats.punctuationDiffs} (${(100*globalStats.punctuationDiffs/Math.max(1,totalDiffs)).toFixed(0)}%)`);
  console.log(`  Abbreviation:      ${globalStats.abbreviationDiffs} (${(100*globalStats.abbreviationDiffs/Math.max(1,totalDiffs)).toFixed(0)}%)`);
  console.log(`  Spelling variant:  ${globalStats.spellingDiffs} (${(100*globalStats.spellingDiffs/Math.max(1,totalDiffs)).toFixed(0)}%)`);
  console.log(`  Likely OCR error:  ${globalStats.ocrErrors} (${(100*globalStats.ocrErrors/Math.max(1,totalDiffs)).toFixed(0)}%)`);
  console.log(`  Major difference:  ${globalStats.majorDiffs} (${(100*globalStats.majorDiffs/Math.max(1,totalDiffs)).toFixed(0)}%)`);

  if (globalStats.translationPairs > 0) {
    console.log();
    console.log(`Translation stability (same Latin → English):`);
    console.log(`  Pairs compared: ${globalStats.translationPairs}`);
    console.log(`  Avg similarity: ${(globalStats.translationSimSum / globalStats.translationPairs).toFixed(3)}`);
  }

  if (globalStats.exampleDiffs.length > 0) {
    console.log('\nSample differences:');
    for (const d of globalStats.exampleDiffs.slice(0, 15)) {
      console.log(`  [${d.type}] "${d.a}" → "${d.b}" (${d.cluster})`);
    }
  }

  await client.close();
}

const diff_keys = ['punctuation', 'abbreviation', 'spelling', 'ocr', 'major'];
main().catch(e => { console.error(e); process.exit(1); });
