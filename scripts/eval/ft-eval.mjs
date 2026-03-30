#!/usr/bin/env npx tsx
/**
 * First-Translation Verification Evaluator
 *
 * Subcommands:
 *   seed   — Query the DB for benchmark candidates, output suggested cases
 *   run    — Run verification on all benchmark cases, compare to ground truth
 *   report — Show the last evaluation report without re-running
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/eval/ft-eval.mjs seed [--count 60]
 *   npx tsx scripts/eval/ft-eval.mjs run [--force] [--save]
 *   npx tsx scripts/eval/ft-eval.mjs report
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BENCHMARK_PATH = path.join(__dirname, 'ft-benchmark.json');
const REPORT_PATH = path.join(__dirname, 'ft-eval-report.json');

// ── Env loading ──────────────────────────────────────────────────────

function loadEnv() {
  const envFiles = ['.env.production.local', '.env.local'];
  for (const file of envFiles) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      for (const line of content.split('\n')) {
        const m = line.match(/^([^=#]+)=(.*)$/);
        if (m) {
          let v = m[2].trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
            v = v.slice(1, -1);
          if (!process.env[m[1].trim()]) {
            process.env[m[1].trim()] = v;
          }
        }
      }
      break;
    } catch { /* try next */ }
  }
}

loadEnv();

// ── DB connection ────────────────────────────────────────────────────

async function connect() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set. Run: set -a; source .env.production.local; set +a');
    process.exit(1);
  }
  const client = new MongoClient(uri);
  await client.connect();
  return { client, db: client.db(process.env.MONGODB_DB || 'bookstore') };
}

// ── Benchmark I/O ────────────────────────────────────────────────────

function loadBenchmark() {
  try {
    return JSON.parse(fs.readFileSync(BENCHMARK_PATH, 'utf8'));
  } catch {
    return { metadata: { version: 1 }, cases: [] };
  }
}

function saveBenchmark(benchmark) {
  fs.writeFileSync(BENCHMARK_PATH, JSON.stringify(benchmark, null, 2) + '\n');
}

// ── Subcommand: seed ─────────────────────────────────────────────────

async function seed(args) {
  const count = parseInt(args.find(a => a.startsWith('--count='))?.split('=')[1] || '60');
  const { client, db } = await connect();
  const books = db.collection('books');

  console.log(`\nQuerying for benchmark candidates (target: ${count} cases)...\n`);

  // We want a stratified sample across dispositions, confidence levels, and difficulty
  const strata = [
    {
      label: 'translation_found (high confidence)',
      filter: {
        'translation_verification.disposition': 'translation_found',
        'translation_verification.confidence': 'high',
        'translation_verification.tools_called': { $exists: true },
      },
      target: Math.ceil(count * 0.25), // 25% — known translations
      difficulty: 'easy',
    },
    {
      label: 'confirmed_first (high confidence, well-known author)',
      filter: {
        'translation_verification.disposition': 'confirmed_first',
        'translation_verification.confidence': 'high',
        'translation_verification.tools_called': { $exists: true },
        author: { $ne: null, $ne: 'Unknown', $ne: '' },
      },
      target: Math.ceil(count * 0.20), // 20% — claimed firsts with known authors (most likely to be wrong)
      difficulty: 'medium',
    },
    {
      label: 'confirmed_first (anonymous or obscure)',
      filter: {
        'translation_verification.disposition': 'confirmed_first',
        'translation_verification.tools_called': { $exists: true },
        $or: [
          { author: null },
          { author: 'Unknown' },
          { author: '' },
          { author: { $regex: /anonym/i } },
        ],
      },
      target: Math.ceil(count * 0.10), // 10% — obscure firsts (probably correct)
      difficulty: 'easy',
    },
    {
      label: 'first_complete_translation',
      filter: {
        'translation_verification.disposition': 'first_complete_translation',
        'translation_verification.tools_called': { $exists: true },
      },
      target: Math.ceil(count * 0.12), // 12%
      difficulty: 'hard',
    },
    {
      label: 'first_modern_translation',
      filter: {
        'translation_verification.disposition': 'first_modern_translation',
        'translation_verification.tools_called': { $exists: true },
      },
      target: Math.ceil(count * 0.08), // 8%
      difficulty: 'hard',
    },
    {
      label: 'first_from_source',
      filter: {
        'translation_verification.disposition': 'first_from_source',
        'translation_verification.tools_called': { $exists: true },
      },
      target: Math.ceil(count * 0.08), // 8%
      difficulty: 'hard',
    },
    {
      label: 'needs_review',
      filter: {
        'translation_verification.disposition': 'needs_review',
        'translation_verification.tools_called': { $exists: true },
      },
      target: Math.ceil(count * 0.05), // 5%
      difficulty: 'hard',
    },
    {
      label: 'translation_found (low/medium confidence)',
      filter: {
        'translation_verification.disposition': 'translation_found',
        'translation_verification.confidence': { $in: ['low', 'medium'] },
        'translation_verification.tools_called': { $exists: true },
      },
      target: Math.ceil(count * 0.12), // 12% — uncertain negatives (most likely to flip)
      difficulty: 'medium',
    },
  ];

  const candidates = [];

  for (const stratum of strata) {
    const available = await books.countDocuments(stratum.filter);
    const sample = await books.find(stratum.filter)
      .project({
        id: 1, title: 1, display_title: 1, author: 1, language: 1,
        is_first_translation: 1,
        'translation_verification.disposition': 1,
        'translation_verification.confidence': 1,
        'translation_verification.reasoning': 1,
        'translation_verification.translations_found': 1,
        'translation_verification.tools_called': 1,
        'translation_verification.model': 1,
      })
      // Use $sample for random selection
      .limit(stratum.target * 3) // Oversample, then take random subset
      .toArray();

    // Shuffle and take target count
    const shuffled = sample.sort(() => Math.random() - 0.5).slice(0, stratum.target);

    for (const book of shuffled) {
      const tv = book.translation_verification || {};
      candidates.push({
        book_id: book.id,
        title: book.display_title || book.title || 'Unknown',
        author: book.author || 'Unknown',
        language: book.language || 'Unknown',
        current_disposition: tv.disposition,
        current_confidence: tv.confidence,
        current_reasoning: tv.reasoning?.slice(0, 200),
        current_translations_found: (tv.translations_found || []).map(t => ({
          english_title: t.english_title,
          translator: t.translator,
          pub_year: t.pub_year,
          evidence_source: t.evidence_source,
        })),
        current_tools_called: tv.tools_called,
        current_model: tv.model,
        // Fields the human reviewer needs to fill in:
        expected_disposition: tv.disposition, // Pre-fill with current — reviewer overrides if wrong
        expected_is_first: ['confirmed_first', 'first_from_source', 'first_complete_translation', 'first_modern_translation'].includes(tv.disposition),
        ground_truth_source: 'NEEDS REVIEW — pre-filled from current verification',
        difficulty: stratum.difficulty,
        category: stratum.label,
      });
    }

    console.log(`  ${stratum.label}: ${shuffled.length}/${available} available (target: ${stratum.target})`);
  }

  console.log(`\nTotal candidates: ${candidates.length}`);

  // Check if benchmark already has cases
  const benchmark = loadBenchmark();
  const existingIds = new Set(benchmark.cases.map(c => c.book_id));
  const newCandidates = candidates.filter(c => !existingIds.has(c.book_id));

  if (newCandidates.length === 0) {
    console.log('\nAll candidates already in benchmark. Use --count=N for a larger sample.');
    await client.close();
    return;
  }

  // Write candidates to a review file (not directly to benchmark)
  const reviewPath = path.join(__dirname, 'ft-benchmark-candidates.json');
  const reviewData = {
    metadata: {
      generated: new Date().toISOString(),
      description: 'Review these candidates and move approved ones to ft-benchmark.json. Verify expected_disposition and set ground_truth_source.',
      total: newCandidates.length,
    },
    candidates: newCandidates,
  };
  fs.writeFileSync(reviewPath, JSON.stringify(reviewData, null, 2) + '\n');

  console.log(`\nWrote ${newCandidates.length} candidates to: ${reviewPath}`);
  console.log('\nNext steps:');
  console.log('  1. Review each candidate — verify expected_disposition is correct');
  console.log('  2. Set ground_truth_source to explain how you verified (e.g., "WorldCat search", "subject expertise")');
  console.log('  3. Run: npx tsx scripts/eval/ft-eval.mjs adopt  — to move reviewed candidates into the benchmark');
  console.log('  4. Or manually copy approved entries into ft-benchmark.json');

  await client.close();
}

// ── Subcommand: adopt ────────────────────────────────────────────────

async function adopt() {
  const reviewPath = path.join(__dirname, 'ft-benchmark-candidates.json');
  if (!fs.existsSync(reviewPath)) {
    console.error('No candidates file found. Run `seed` first.');
    process.exit(1);
  }

  const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
  const benchmark = loadBenchmark();
  const existingIds = new Set(benchmark.cases.map(c => c.book_id));

  // Only adopt candidates that have been reviewed (ground_truth_source changed from default)
  const reviewed = review.candidates.filter(c =>
    c.ground_truth_source !== 'NEEDS REVIEW — pre-filled from current verification'
  );
  const unreviewed = review.candidates.filter(c =>
    c.ground_truth_source === 'NEEDS REVIEW — pre-filled from current verification'
  );

  let adopted = 0;
  for (const candidate of reviewed) {
    if (existingIds.has(candidate.book_id)) continue;

    // Strip the "current_*" fields — they're only for review context
    benchmark.cases.push({
      book_id: candidate.book_id,
      title: candidate.title,
      author: candidate.author,
      language: candidate.language,
      expected_disposition: candidate.expected_disposition,
      expected_is_first: candidate.expected_is_first,
      ground_truth_source: candidate.ground_truth_source,
      difficulty: candidate.difficulty,
      category: candidate.category,
      known_translations: candidate.current_translations_found?.length > 0
        ? candidate.current_translations_found : undefined,
    });
    adopted++;
  }

  if (adopted === 0 && unreviewed.length > 0) {
    console.log(`\n${unreviewed.length} candidates still have default ground_truth_source.`);
    console.log('Edit ft-benchmark-candidates.json to set ground_truth_source, then re-run adopt.');
    console.log('\nTo adopt ALL candidates with current dispositions as ground truth (quick baseline):');
    console.log('  npx tsx scripts/eval/ft-eval.mjs adopt --trust-current');
    return;
  }

  saveBenchmark(benchmark);
  console.log(`\nAdopted ${adopted} reviewed cases into benchmark.`);
  console.log(`${unreviewed.length} unreviewed candidates remaining.`);
  console.log(`Benchmark now has ${benchmark.cases.length} total cases.`);
}

async function adoptTrustCurrent() {
  const reviewPath = path.join(__dirname, 'ft-benchmark-candidates.json');
  if (!fs.existsSync(reviewPath)) {
    console.error('No candidates file found. Run `seed` first.');
    process.exit(1);
  }

  const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
  const benchmark = loadBenchmark();
  const existingIds = new Set(benchmark.cases.map(c => c.book_id));

  let adopted = 0;
  for (const candidate of review.candidates) {
    if (existingIds.has(candidate.book_id)) continue;

    benchmark.cases.push({
      book_id: candidate.book_id,
      title: candidate.title,
      author: candidate.author,
      language: candidate.language,
      expected_disposition: candidate.expected_disposition,
      expected_is_first: candidate.expected_is_first,
      ground_truth_source: `Trusted from previous verification (${candidate.current_model}, ${candidate.current_confidence} confidence)`,
      difficulty: candidate.difficulty,
      category: candidate.category,
      known_translations: candidate.current_translations_found?.length > 0
        ? candidate.current_translations_found : undefined,
    });
    adopted++;
  }

  saveBenchmark(benchmark);
  console.log(`\nAdopted ${adopted} cases (trusting current dispositions as ground truth).`);
  console.log(`Benchmark now has ${benchmark.cases.length} total cases.`);
  console.log('\nWARNING: These ground-truth labels come from the existing pipeline.');
  console.log('This gives you a consistency/regression baseline, NOT an accuracy measurement.');
  console.log('For true accuracy, manually verify ground_truth_source on each case.');
}

// ── Subcommand: run ──────────────────────────────────────────────────

async function run(args) {
  const force = args.includes('--force');
  const save = args.includes('--save');
  const benchmark = loadBenchmark();

  if (benchmark.cases.length === 0) {
    console.error('Benchmark is empty. Run `seed` first, then `adopt` to populate.');
    process.exit(1);
  }

  console.log(`\nFirst-Translation Verification Evaluation`);
  console.log(`==========================================`);
  console.log(`Benchmark: ${benchmark.cases.length} cases`);
  console.log(`Mode: ${force ? 'FORCE (re-verify all)' : 'normal (skip already-verified)'}`);
  console.log('');

  const { client, db } = await connect();

  // Import the verification function
  let verifyFirstTranslation;
  try {
    const mod = await import('../../src/lib/verify-first-translation.ts');
    verifyFirstTranslation = mod.verifyFirstTranslation;
  } catch (err) {
    console.error('Cannot import verify-first-translation.ts. Run with: npx tsx scripts/eval/ft-eval.mjs run');
    console.error(err.message);
    await client.close();
    process.exit(1);
  }

  const results = [];
  const startTime = Date.now();
  let totalCost = 0;

  for (let i = 0; i < benchmark.cases.length; i++) {
    const testCase = benchmark.cases[i];
    const label = `[${i + 1}/${benchmark.cases.length}]`;

    process.stdout.write(`${label} ${testCase.author} — ${testCase.title.slice(0, 50)}... `);

    try {
      const result = await verifyFirstTranslation(db, testCase.book_id, {
        dryRun: true, // NEVER write to DB during eval
        force: true,  // Always re-run for eval (even if already verified)
      });

      if (!result.success) {
        console.log(`ERROR: ${result.error}`);
        results.push({
          ...testCase,
          actual_disposition: null,
          actual_is_first: null,
          tools_called: [],
          cost_usd: 0,
          match: false,
          error: result.error,
        });
        continue;
      }

      const v = result.verification;
      const match = v.disposition === testCase.expected_disposition;
      const isFirstMatch = result.is_first_translation === testCase.expected_is_first;
      totalCost += v.cost_usd || 0;

      const icon = match ? '  OK' : isFirstMatch ? ' ~OK' : ' MISS';
      console.log(`${icon}  expected=${testCase.expected_disposition}  got=${v.disposition}  (${v.confidence}, ${v.tools_called.length} tools, $${(v.cost_usd || 0).toFixed(4)})`);

      results.push({
        book_id: testCase.book_id,
        title: testCase.title,
        author: testCase.author,
        language: testCase.language,
        expected_disposition: testCase.expected_disposition,
        expected_is_first: testCase.expected_is_first,
        actual_disposition: v.disposition,
        actual_is_first: result.is_first_translation,
        actual_confidence: v.confidence,
        actual_reasoning: v.reasoning,
        actual_translations_found: v.translations_found,
        tools_called: v.tools_called,
        cost_usd: v.cost_usd || 0,
        disposition_match: match,
        binary_match: isFirstMatch,
        difficulty: testCase.difficulty,
        category: testCase.category,
      });
    } catch (err) {
      console.log(`CRASH: ${err.message}`);
      results.push({
        ...testCase,
        actual_disposition: null,
        actual_is_first: null,
        tools_called: [],
        cost_usd: 0,
        disposition_match: false,
        binary_match: false,
        error: err.message,
      });
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // ── Compute metrics ────────────────────────────────────────────────

  const valid = results.filter(r => r.actual_disposition !== null);
  const errors = results.filter(r => r.actual_disposition === null);

  // Binary classification: is_first_translation true/false
  const tp = valid.filter(r => r.expected_is_first && r.actual_is_first).length;
  const fp = valid.filter(r => !r.expected_is_first && r.actual_is_first).length;
  const tn = valid.filter(r => !r.expected_is_first && !r.actual_is_first).length;
  const fn = valid.filter(r => r.expected_is_first && !r.actual_is_first).length;

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;
  const accuracy = valid.length > 0 ? (tp + tn) / valid.length : 0;

  // Disposition-level accuracy
  const dispositionCorrect = valid.filter(r => r.disposition_match).length;
  const dispositionAccuracy = valid.length > 0 ? dispositionCorrect / valid.length : 0;

  // Per-disposition breakdown
  const dispositions = ['confirmed_first', 'first_from_source', 'first_complete_translation', 'first_modern_translation', 'translation_found', 'needs_review'];
  const dispositionBreakdown = {};
  for (const d of dispositions) {
    const cases = valid.filter(r => r.expected_disposition === d);
    if (cases.length === 0) continue;
    const correct = cases.filter(r => r.disposition_match).length;
    dispositionBreakdown[d] = {
      total: cases.length,
      correct,
      accuracy: (correct / cases.length * 100).toFixed(1) + '%',
      misclassified_as: cases
        .filter(r => !r.disposition_match)
        .map(r => `${r.actual_disposition} (${r.title.slice(0, 30)})`)
    };
  }

  // Tool usage stats
  const toolCounts = {};
  for (const r of valid) {
    for (const tool of r.tools_called) {
      toolCounts[tool] = (toolCounts[tool] || 0) + 1;
    }
  }
  const avgToolsPerCase = valid.length > 0
    ? (valid.reduce((sum, r) => sum + r.tools_called.length, 0) / valid.length).toFixed(1)
    : 0;

  // False positives (CRITICAL — we claimed first but translation exists)
  const falsePositives = valid.filter(r => !r.expected_is_first && r.actual_is_first);
  // False negatives (we missed a first)
  const falseNegatives = valid.filter(r => r.expected_is_first && !r.actual_is_first);

  // ── Print report ───────────────────────────────────────────────────

  console.log('\n' + '='.repeat(70));
  console.log('EVALUATION REPORT');
  console.log('='.repeat(70));
  console.log(`Date:     ${new Date().toISOString()}`);
  console.log(`Cases:    ${results.length} total, ${valid.length} valid, ${errors.length} errors`);
  console.log(`Time:     ${elapsed}s`);
  console.log(`Cost:     $${totalCost.toFixed(4)}`);
  console.log(`Avg cost: $${valid.length > 0 ? (totalCost / valid.length).toFixed(4) : '0'}/case`);
  console.log('');

  console.log('Binary Classification (is_first_translation: true/false)');
  console.log('-'.repeat(50));
  console.log(`  Accuracy:  ${(accuracy * 100).toFixed(1)}% (${tp + tn}/${valid.length})`);
  console.log(`  Precision: ${(precision * 100).toFixed(1)}% (of "first" claims, ${tp} correct, ${fp} false)`);
  console.log(`  Recall:    ${(recall * 100).toFixed(1)}% (of actual firsts, ${tp} found, ${fn} missed)`);
  console.log(`  F1:        ${(f1 * 100).toFixed(1)}%`);
  console.log('');

  console.log('Confusion Matrix (binary)');
  console.log('-'.repeat(50));
  console.log(`                    Predicted First  Predicted Not-First`);
  console.log(`  Actual First          ${String(tp).padStart(4)}             ${String(fn).padStart(4)}`);
  console.log(`  Actual Not-First      ${String(fp).padStart(4)}             ${String(tn).padStart(4)}`);
  console.log('');

  console.log(`Disposition Accuracy: ${(dispositionAccuracy * 100).toFixed(1)}% (${dispositionCorrect}/${valid.length})`);
  console.log('-'.repeat(50));
  for (const [d, stats] of Object.entries(dispositionBreakdown)) {
    console.log(`  ${d}: ${stats.accuracy} (${stats.correct}/${stats.total})`);
    if (stats.misclassified_as.length > 0) {
      for (const m of stats.misclassified_as.slice(0, 3)) {
        console.log(`    -> misclassified as: ${m}`);
      }
    }
  }
  console.log('');

  console.log('Tool Usage');
  console.log('-'.repeat(50));
  console.log(`  Avg tools per case: ${avgToolsPerCase}`);
  for (const [tool, count] of Object.entries(toolCounts).sort((a, b) => b[1] - a[1])) {
    const pct = (count / valid.length * 100).toFixed(0);
    console.log(`  ${tool}: ${count} (${pct}% of cases)`);
  }
  console.log('');

  if (falsePositives.length > 0) {
    console.log('FALSE POSITIVES (claimed first, but translation exists)');
    console.log('-'.repeat(50));
    for (const r of falsePositives) {
      console.log(`  ${r.author} — ${r.title.slice(0, 50)}`);
      console.log(`    Expected: ${r.expected_disposition}  Got: ${r.actual_disposition}`);
      console.log(`    Reasoning: ${r.actual_reasoning?.slice(0, 150)}`);
      console.log('');
    }
  }

  if (falseNegatives.length > 0) {
    console.log('FALSE NEGATIVES (missed first translation)');
    console.log('-'.repeat(50));
    for (const r of falseNegatives) {
      console.log(`  ${r.author} — ${r.title.slice(0, 50)}`);
      console.log(`    Expected: ${r.expected_disposition}  Got: ${r.actual_disposition}`);
      console.log(`    Reasoning: ${r.actual_reasoning?.slice(0, 150)}`);
      console.log('');
    }
  }

  // ── Save report ────────────────────────────────────────────────────

  const report = {
    metadata: {
      date: new Date().toISOString(),
      benchmark_version: benchmark.metadata.version,
      cases_total: results.length,
      cases_valid: valid.length,
      cases_error: errors.length,
      elapsed_seconds: parseFloat(elapsed),
      total_cost_usd: totalCost,
    },
    binary_metrics: {
      accuracy, precision, recall, f1,
      true_positives: tp,
      false_positives: fp,
      true_negatives: tn,
      false_negatives: fn,
    },
    disposition_metrics: {
      accuracy: dispositionAccuracy,
      correct: dispositionCorrect,
      total: valid.length,
      per_disposition: dispositionBreakdown,
    },
    tool_usage: {
      avg_per_case: parseFloat(avgToolsPerCase),
      counts: toolCounts,
    },
    false_positives: falsePositives.map(r => ({
      book_id: r.book_id,
      title: r.title,
      author: r.author,
      expected: r.expected_disposition,
      actual: r.actual_disposition,
      reasoning: r.actual_reasoning,
    })),
    false_negatives: falseNegatives.map(r => ({
      book_id: r.book_id,
      title: r.title,
      author: r.author,
      expected: r.expected_disposition,
      actual: r.actual_disposition,
      reasoning: r.actual_reasoning,
    })),
    results,
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
  console.log(`Full report saved to: ${REPORT_PATH}`);

  // Update benchmark metadata
  benchmark.metadata.last_evaluated = new Date().toISOString();
  saveBenchmark(benchmark);

  await client.close();
}

// ── Subcommand: report ───────────────────────────────────────────────

async function report() {
  if (!fs.existsSync(REPORT_PATH)) {
    console.error('No report found. Run `npx tsx scripts/eval/ft-eval.mjs run` first.');
    process.exit(1);
  }

  const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
  const m = report.metadata;
  const b = report.binary_metrics;
  const d = report.disposition_metrics;

  console.log(`\nLast evaluation: ${m.date}`);
  console.log(`Cases: ${m.cases_valid} valid / ${m.cases_total} total`);
  console.log(`Cost: $${m.total_cost_usd.toFixed(4)} (${m.elapsed_seconds}s)`);
  console.log('');
  console.log(`Binary:      acc=${(b.accuracy * 100).toFixed(1)}%  prec=${(b.precision * 100).toFixed(1)}%  rec=${(b.recall * 100).toFixed(1)}%  F1=${(b.f1 * 100).toFixed(1)}%`);
  console.log(`Disposition: acc=${(d.accuracy * 100).toFixed(1)}% (${d.correct}/${d.total})`);
  console.log(`FP: ${report.false_positives.length}  FN: ${report.false_negatives.length}`);

  if (report.false_positives.length > 0) {
    console.log('\nFalse Positives:');
    for (const fp of report.false_positives) {
      console.log(`  ${fp.author} — ${fp.title.slice(0, 50)}: expected ${fp.expected}, got ${fp.actual}`);
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case 'seed':
    await seed(args);
    break;
  case 'adopt':
    if (args.includes('--trust-current')) {
      await adoptTrustCurrent();
    } else {
      await adopt();
    }
    break;
  case 'run':
    await run(args);
    break;
  case 'report':
    await report();
    break;
  default:
    console.log(`
First-Translation Verification Evaluator

Usage:
  npx tsx scripts/eval/ft-eval.mjs <command>

Commands:
  seed                   Query DB for benchmark candidates (writes candidates file)
  adopt                  Move reviewed candidates into the benchmark
  adopt --trust-current  Accept all candidates with current dispositions as ground truth
  run                    Run verification on benchmark, compare to ground truth
  report                 Show last evaluation report

Workflow:
  1. seed    — generates candidates for human review
  2. adopt   — moves reviewed candidates into benchmark
  3. run     — evaluates the verification pipeline
  4. report  — view results without re-running
`);
}
