#!/usr/bin/env node
/**
 * LLM-based dedup validation — Method 6 for the paper.
 *
 * Takes record pairs and asks Gemini to classify them at FRBR levels.
 * Can run on:
 *   1. The gold standard pairs (for evaluation)
 *   2. Flagged clusters (10+ size, for validation)
 *   3. Unclustered cross-source pairs (for missed match detection)
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node research/dedup-paper/llm-validate.mjs --mode=gold-standard
 *   node research/dedup-paper/llm-validate.mjs --mode=validate-clusters --min-size=10
 *   node research/dedup-paper/llm-validate.mjs --mode=find-missed --sample=200
 */

import { readFileSync, writeFileSync } from 'fs';
import { MongoClient } from 'mongodb';

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; })
);

const MODE = args.mode || 'gold-standard';
const MIN_SIZE = parseInt(args['min-size']) || 10;
const SAMPLE = parseInt(args.sample) || 200;
const DELAY = parseInt(args.delay) || 500;
const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) { console.error('GEMINI_API_KEY required'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Gemini API ───────────────────────────────────────────────────────────

async function classifyPair(recordA, recordB) {
  const prompt = `You are an expert bibliographer specializing in pre-modern European books (manuscripts, incunabula, and early printed works from before 1800).

Given two catalog records from different digital libraries, classify their relationship. Consider title, author, date, language, and any other clues.

RECORD A:
  Source: ${recordA.source}
  Title: ${recordA.title}
  Author: ${recordA.author}
  Date: ${recordA.date_text || 'unknown'}
  Language: ${recordA.language || 'unknown'}

RECORD B:
  Source: ${recordB.source}
  Title: ${recordB.title}
  Author: ${recordB.author}
  Date: ${recordB.date_text || 'unknown'}
  Language: ${recordB.language || 'unknown'}

Classify as exactly ONE of:
- SAME_ITEM: Same digitized object, just different catalog entries (identical title, author, date, source)
- SAME_EDITION: Same printing/edition, possibly different physical copies or at different libraries (same title, author, date, but different source or ID)
- SAME_WORK: Same intellectual content but different edition, printing, or translation (same author and subject, but different date, place, or language)
- DIFFERENT_WORK: Different books that happen to have similar titles or the same author

Respond with ONLY a JSON object, no other text:
{"classification": "SAME_ITEM|SAME_EDITION|SAME_WORK|DIFFERENT_WORK", "confidence": "high|medium|low", "reasoning": "one sentence explanation"}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 200,
          responseMimeType: 'application/json',
        },
      }),
      signal: AbortSignal.timeout(30000),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty Gemini response');

  try {
    return JSON.parse(text);
  } catch {
    // Try to extract JSON from response
    const match = text.match(/\{[^}]+\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error(`Invalid JSON: ${text.slice(0, 200)}`);
  }
}

// ── Mode: Gold Standard ──────────────────────────────────────────────────

async function runGoldStandard() {
  const pairsPath = new URL('./gold-standard-pairs.json', import.meta.url).pathname;
  const pairs = JSON.parse(readFileSync(pairsPath, 'utf8'));

  console.log(`Classifying ${pairs.length} gold standard pairs with Gemini...\n`);

  const results = [];
  let done = 0;

  for (const pair of pairs) {
    try {
      const result = await classifyPair(pair.a, pair.b);
      results.push({
        pair_id: pair.pair_id,
        stratum: pair.stratum,
        expected_label: pair.expected_label,
        llm_classification: result.classification,
        llm_confidence: result.confidence,
        llm_reasoning: result.reasoning,
      });
      done++;

      if (done % 25 === 0) {
        console.log(`  ${done}/${pairs.length} classified`);
      }
    } catch (err) {
      console.error(`  Pair ${pair.pair_id} failed: ${err.message}`);
      results.push({
        pair_id: pair.pair_id,
        stratum: pair.stratum,
        expected_label: pair.expected_label,
        llm_classification: 'ERROR',
        llm_confidence: null,
        llm_reasoning: err.message,
      });
    }

    await sleep(DELAY);
  }

  // Save results
  const outPath = new URL('./llm-gold-standard-results.json', import.meta.url).pathname;
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nSaved to ${outPath}`);

  // Summary
  printSummary(results);
}

// ── Mode: Validate Clusters ──────────────────────────────────────────────

async function runValidateClusters() {
  const uri = process.env.MONGODB_URI;
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('bookstore');
  const col = db.collection('import_candidates');

  // Get clusters of size >= MIN_SIZE
  const clusters = await col.aggregate([
    { $match: { dedup_cluster: { $exists: true }, dedup_cluster_size: { $gte: MIN_SIZE } } },
    { $group: {
      _id: '$dedup_cluster',
      size: { $first: '$dedup_cluster_size' },
      records: { $push: { title: '$title', author: '$author', date_text: '$date_text', language: '$language', source: '$source', source_id: '$source_id' } }
    }},
    { $sort: { size: -1 } },
    { $limit: SAMPLE }
  ]).toArray();

  console.log(`Validating ${clusters.length} clusters (size >= ${MIN_SIZE}) with Gemini...\n`);

  const results = [];
  let done = 0;

  for (const cluster of clusters) {
    // Compare the first record against the last (most distant in the chain)
    const first = cluster.records[0];
    const last = cluster.records[cluster.records.length - 1];
    // Also compare first against middle
    const mid = cluster.records[Math.floor(cluster.records.length / 2)];

    try {
      const endpointResult = await classifyPair(first, last);
      await sleep(DELAY);
      const midpointResult = await classifyPair(first, mid);

      results.push({
        cluster_id: cluster._id,
        cluster_size: cluster.size,
        first_vs_last: endpointResult,
        first_vs_mid: midpointResult,
        first_title: first.title?.slice(0, 80),
        last_title: last.title?.slice(0, 80),
        mid_title: mid.title?.slice(0, 80),
        verdict: endpointResult.classification === 'DIFFERENT_WORK' ? 'FALSE_POSITIVE_CLUSTER' : 'VALID_CLUSTER',
      });

      done++;
      if (done % 10 === 0) {
        const fps = results.filter(r => r.verdict === 'FALSE_POSITIVE_CLUSTER').length;
        console.log(`  ${done}/${clusters.length} validated | ${fps} false positive clusters found`);
      }
    } catch (err) {
      console.error(`  Cluster ${cluster._id} failed: ${err.message}`);
    }

    await sleep(DELAY);
  }

  const outPath = new URL('./llm-cluster-validation.json', import.meta.url).pathname;
  writeFileSync(outPath, JSON.stringify(results, null, 2));

  const fps = results.filter(r => r.verdict === 'FALSE_POSITIVE_CLUSTER').length;
  console.log(`\n=== Cluster Validation Results ===`);
  console.log(`Clusters checked: ${results.length}`);
  console.log(`Valid clusters: ${results.length - fps}`);
  console.log(`False positive clusters: ${fps} (${(fps / results.length * 100).toFixed(1)}%)`);
  console.log(`Saved to ${outPath}`);

  await client.close();
}

// ── Mode: Find Missed Matches ────────────────────────────────────────────

async function runFindMissed() {
  const uri = process.env.MONGODB_URI;
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('bookstore');
  const col = db.collection('import_candidates');

  // Find unclustered records by the same author across different sources
  const candidates = await col.aggregate([
    { $match: { status: 'discovered', dedup_cluster: { $exists: false }, author: { $nin: ['Unknown', '[s.n.]', ''] } } },
    { $group: { _id: '$author', sources: { $addToSet: '$source' }, records: { $push: { title: '$title', author: '$author', date_text: '$date_text', language: '$language', source: '$source' } } } },
    { $match: { 'sources.1': { $exists: true } } },
    { $sample: { size: SAMPLE } }
  ]).toArray();

  console.log(`Checking ${candidates.length} cross-source author groups for missed matches...\n`);

  const results = [];
  let done = 0;
  let found = 0;

  for (const group of candidates) {
    // Pick one record from each source
    const bySource = {};
    group.records.forEach(r => { if (!bySource[r.source]) bySource[r.source] = r; });
    const sources = Object.values(bySource);
    if (sources.length < 2) continue;

    try {
      const result = await classifyPair(sources[0], sources[1]);

      if (result.classification !== 'DIFFERENT_WORK') {
        found++;
        results.push({
          author: group._id,
          record_a: { source: sources[0].source, title: sources[0].title?.slice(0, 80), date: sources[0].date_text },
          record_b: { source: sources[1].source, title: sources[1].title?.slice(0, 80), date: sources[1].date_text },
          llm_classification: result.classification,
          llm_confidence: result.confidence,
          llm_reasoning: result.reasoning,
        });
      }

      done++;
      if (done % 25 === 0) {
        console.log(`  ${done}/${candidates.length} checked | ${found} missed matches found`);
      }
    } catch (err) {
      // Skip errors
    }

    await sleep(DELAY);
  }

  const outPath = new URL('./llm-missed-matches.json', import.meta.url).pathname;
  writeFileSync(outPath, JSON.stringify(results, null, 2));

  console.log(`\n=== Missed Match Detection ===`);
  console.log(`Author groups checked: ${done}`);
  console.log(`Missed matches found: ${found} (${(found / done * 100).toFixed(1)}%)`);
  console.log(`Saved to ${outPath}`);

  await client.close();
}

// ── Summary ──────────────────────────────────────────────────────────────

function printSummary(results) {
  console.log('\n=== LLM Classification Summary ===\n');

  // By stratum
  const strata = {};
  results.forEach(r => {
    const key = r.stratum;
    if (!strata[key]) strata[key] = { total: 0, classifications: {} };
    strata[key].total++;
    const cls = r.llm_classification;
    strata[key].classifications[cls] = (strata[key].classifications[cls] || 0) + 1;
  });

  for (const [stratum, data] of Object.entries(strata).sort()) {
    console.log(`${stratum} (${data.total} pairs):`);
    for (const [cls, count] of Object.entries(data.classifications).sort((a, b) => b[1] - a[1])) {
      const pct = (count / data.total * 100).toFixed(0);
      console.log(`  ${cls}: ${count} (${pct}%)`);
    }
    console.log('');
  }

  // Overall
  const overall = {};
  results.forEach(r => { overall[r.llm_classification] = (overall[r.llm_classification] || 0) + 1; });
  console.log('Overall:');
  for (const [cls, count] of Object.entries(overall).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cls}: ${count} (${(count / results.length * 100).toFixed(1)}%)`);
  }

  // Confidence
  const conf = {};
  results.forEach(r => { if (r.llm_confidence) conf[r.llm_confidence] = (conf[r.llm_confidence] || 0) + 1; });
  console.log('\nConfidence:');
  for (const [c, count] of Object.entries(conf).sort()) {
    console.log(`  ${c}: ${count} (${(count / results.length * 100).toFixed(1)}%)`);
  }

  // Agreement with expected labels
  console.log('\nAgreement with expected labels:');
  const expectedMap = {
    'same_manifestation': ['SAME_ITEM', 'SAME_EDITION'],
    'same_manifestation_or_work': ['SAME_ITEM', 'SAME_EDITION', 'SAME_WORK'],
    'same_work_different_edition': ['SAME_WORK'],
    'same_work_different_volume': ['SAME_WORK'],
    'different_work': ['DIFFERENT_WORK'],
    'likely_different': ['DIFFERENT_WORK'],
    'unknown': null, // can't evaluate
  };

  let agree = 0, disagree = 0, unevaluable = 0;
  for (const r of results) {
    if (r.llm_classification === 'ERROR') { unevaluable++; continue; }
    const expected = expectedMap[r.expected_label];
    if (!expected) { unevaluable++; continue; }
    if (expected.includes(r.llm_classification)) agree++;
    else disagree++;
  }
  console.log(`  Agree: ${agree} | Disagree: ${disagree} | Unevaluable: ${unevaluable}`);
  if (agree + disagree > 0) {
    console.log(`  Agreement rate: ${(agree / (agree + disagree) * 100).toFixed(1)}%`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

console.log(`\n=== LLM Dedup Validation ===`);
console.log(`Mode: ${MODE}\n`);

switch (MODE) {
  case 'gold-standard':
    await runGoldStandard();
    break;
  case 'validate-clusters':
    await runValidateClusters();
    break;
  case 'find-missed':
    await runFindMissed();
    break;
  default:
    console.error(`Unknown mode: ${MODE}. Use: gold-standard, validate-clusters, find-missed`);
}
