#!/usr/bin/env node
/**
 * QA-Eval: Scalable OCR & Translation Quality Evaluation Framework
 *
 * Subcommands:
 *   consistency   — Run OCR N times per model, compute MCR and pairwise similarity
 *   cross-model   — Compare best runs across models
 *   embedding     — Embedding-space evaluation (hallucination detection)
 *   compare       — Compare against ground truth (CER, BLEU, ROUGE)
 *   matrix        — Run full evaluation across all registered corpora
 *   readiness     — Quick corpus readiness score
 *   report        — Show last results
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/qa-eval.mjs consistency --corpus=bhutan --sample=10 --models=flash,opus --runs=3
 *   node scripts/eval/qa-eval.mjs embedding --corpus=bhutan --sample=10
 *   node scripts/eval/qa-eval.mjs report --latest
 *   node scripts/eval/qa-eval.mjs report --format=blog --corpus=bhutan
 *
 * See: https://github.com/JDerekLomas/sourcelibrary/issues/1329
 */

import { loadEnv, samplePages, disconnect, loadCorpusRegistry } from './lib/sampling.mjs';
import { runModel, resolveModel, fetchImage, estimateCost } from './lib/runners.mjs';
import { mcr, pairwiseMetrics, charSimilarity, syllableSimilarity, cleanText, cer, bleu4, rougeL } from './lib/metrics.mjs';
import { saveResults, loadLatestResults, listResults, generateConsistencyReport, generateEmbeddingReport, generateMatrixReport, saveBlogPost } from './lib/report.mjs';
import { evaluateCorpus, evaluateRunConsistency } from './lib/embedding-eval.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

loadEnv();

// ── CLI argument parsing ───────────────────────────────────────────

function parseArgs(argv) {
  const args = { _: [] };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--')) {
      const [key, ...rest] = arg.slice(2).split('=');
      args[key] = rest.length > 0 ? rest.join('=') : true;
    } else {
      args._.push(arg);
    }
  }
  return args;
}

const args = parseArgs(process.argv);
const command = args._[0];

const DEFAULT_PROMPT = 'Transcribe ALL text visible in this image using the appropriate Unicode script. Output ONLY the raw text. No commentary, no translation, no labels, no markdown.';

// ── Subcommand: consistency ────────────────────────────────────────

async function cmdConsistency() {
  const corpus = args.corpus;
  if (!corpus) { console.error('--corpus required'); process.exit(1); }

  const sampleSize = parseInt(args.sample || '10');
  const runs = parseInt(args.runs || '3');
  const modelNames = (args.models || 'flash').split(',');
  const models = modelNames.map(resolveModel);
  const delayMs = parseInt(args.delay || '2000');
  const prompt = args.prompt || DEFAULT_PROMPT;
  const temperatures = (args.temp || '0').split(',').map(Number);
  const thinking = args.thinking === true || args.thinking === 'true';
  const mediaResolution = args['media-resolution'] || undefined; // 'low', 'medium', 'high'

  // Cost estimate
  if (args['dry-run']) {
    console.log('Cost estimate:');
    for (const model of models) {
      const est = estimateCost(model, runs * temperatures.length, sampleSize);
      console.log(`  ${model}: ${est.calls} calls across ${temperatures.length} temp(s), ~$${est.estimatedUsd.toFixed(3)}`);
    }
    return;
  }

  console.log(`\nOCR Consistency Evaluation`);
  console.log(`  Corpus: ${corpus}`);
  console.log(`  Sample: ${sampleSize} pages`);
  console.log(`  Runs: ${runs} per model per temperature`);
  console.log(`  Models: ${models.join(', ')}`);
  console.log(`  Temperatures: ${temperatures.join(', ')}`);
  if (thinking) console.log(`  Thinking: enabled (8192 token budget)`);
  if (mediaResolution) console.log(`  Media resolution: ${mediaResolution}`);
  console.log();

  // Sample pages
  console.log('Sampling pages...');
  const pages = await samplePages(corpus, sampleSize, { requireOcr: !args['no-require-ocr'] });
  console.log(`  Got ${pages.length} pages from ${new Set(pages.map(p => p.bookId)).size} books\n`);

  // Build list of (model, temp) combos — keyed as "model@temp[+thinking][+res]"
  const combos = [];
  for (const model of models) {
    for (const temp of temperatures) {
      let key = `${model}@t${temp}`;
      if (thinking) key += '+think';
      if (mediaResolution) key += `+${mediaResolution}`;
      combos.push({ model, temp, key });
    }
  }

  const results = {
    corpus,
    models,
    temperatures,
    thinking,
    ...(mediaResolution && { mediaResolution }),
    runsPerCombo: runs,
    pages: [],
    summary: { byCombo: {} },
    meta: {
      date: new Date().toISOString().slice(0, 10),
      totalCalls: 0,
      totalCostUsd: 0,
      totalDurationMs: 0,
      costByModel: {},
    },
  };

  for (const c of combos) {
    results.meta.costByModel[c.key] = 0;
    results.summary.byCombo[c.key] = { model: c.model, temp: c.temp, pages: 0, mcrValues: [], charSimValues: [], sylSimValues: [] };
  }

  // Run evaluation
  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    console.log(`Page ${pi + 1}/${pages.length}: ${page.bookTitle} p${page.pageNumber}`);

    // Fetch image once
    let imageBuffer;
    try {
      imageBuffer = await fetchImage(page.imageUrl);
      console.log(`  Image: ${imageBuffer.length} bytes`);
    } catch (err) {
      console.error(`  Failed to fetch image: ${err.message}`);
      continue;
    }

    const pageResult = {
      bookId: page.bookId,
      bookTitle: page.bookTitle,
      pageNumber: page.pageNumber,
      script: page.script,
      results: {},
    };

    for (const combo of combos) {
      const ocrRuns = [];
      let totalCost = 0;
      let totalDuration = 0;

      for (let r = 0; r < runs; r++) {
        try {
          const result = await runModel(combo.model, imageBuffer, prompt, { temperature: combo.temp, thinking, mediaResolution });
          const cleaned = cleanText(result.text, page.script);
          ocrRuns.push(cleaned);
          totalCost += result.costUsd;
          totalDuration += result.durationMs;
          results.meta.totalCalls++;
          results.meta.totalCostUsd += result.costUsd;
          results.meta.totalDurationMs += result.durationMs;
          results.meta.costByModel[combo.key] += result.costUsd;
          process.stdout.write(`  ${combo.key} run ${r + 1}/${runs}: ${cleaned.length} chars\n`);
        } catch (err) {
          console.error(`  ${combo.key} run ${r + 1} ERROR: ${err.message.slice(0, 80)}`);
          ocrRuns.push('');
        }
        if (r < runs - 1) await new Promise(resolve => setTimeout(resolve, delayMs));
      }

      const validRuns = ocrRuns.filter(r => r.length > 0);
      const mcrResult = mcr(validRuns);
      const pairwise = pairwiseMetrics(validRuns, page.script);

      pageResult.results[combo.key] = {
        model: combo.model,
        temperature: combo.temp,
        mcr: mcrResult,
        pairwise,
        costUsd: totalCost,
        durationMs: totalDuration,
        outputLengths: ocrRuns.map(r => r.length),
      };

      // Accumulate summary
      const s = results.summary.byCombo[combo.key];
      s.pages++;
      s.mcrValues.push(mcrResult.rate);
      s.charSimValues.push(pairwise.avgCharSimilarity);
      s.sylSimValues.push(pairwise.avgSyllableSimilarity);
    }

    // Cross-combo comparison at temp=0 (best run from each model)
    const t0combos = combos.filter(c => c.temp === 0 || c.temp === temperatures[0]);
    if (t0combos.length > 1) {
      const bestRuns = {};
      for (const c of t0combos) {
        const r = pageResult.results[c.key];
        bestRuns[c.key] = r?.mcr?.modalOutput || '';
      }

      if (!results.summary.crossModel) results.summary.crossModel = [];
      for (let i = 0; i < t0combos.length; i++) {
        for (let j = i + 1; j < t0combos.length; j++) {
          const cs = charSimilarity(bestRuns[t0combos[i].key], bestRuns[t0combos[j].key]);
          const ss = syllableSimilarity(bestRuns[t0combos[i].key], bestRuns[t0combos[j].key], page.script);
          results.summary.crossModel.push({
            modelA: t0combos[i].key,
            modelB: t0combos[j].key,
            page: `${page.bookId}-p${page.pageNumber}`,
            charSimilarity: cs,
            syllableSimilarity: ss,
          });
        }
      }
    }

    results.pages.push(pageResult);
  }

  // Compute summary averages
  for (const [key, s] of Object.entries(results.summary.byCombo)) {
    s.avgMcr = s.mcrValues.reduce((a, b) => a + b, 0) / (s.mcrValues.length || 1);
    s.avgCharSim = s.charSimValues.reduce((a, b) => a + b, 0) / (s.charSimValues.length || 1);
    s.avgSylSim = s.sylSimValues.reduce((a, b) => a + b, 0) / (s.sylSimValues.length || 1);
    delete s.mcrValues;
    delete s.charSimValues;
    delete s.sylSimValues;
  }

  // Aggregate cross-model by pair
  if (results.summary.crossModel) {
    const pairMap = new Map();
    for (const cm of results.summary.crossModel) {
      const key = `${cm.modelA}|${cm.modelB}`;
      if (!pairMap.has(key)) pairMap.set(key, { charSims: [], sylSims: [], modelA: cm.modelA, modelB: cm.modelB });
      pairMap.get(key).charSims.push(cm.charSimilarity);
      pairMap.get(key).sylSims.push(cm.syllableSimilarity);
    }
    results.summary.crossModel = [...pairMap.values()].map(p => ({
      modelA: p.modelA,
      modelB: p.modelB,
      charSimilarity: p.charSims.reduce((a, b) => a + b, 0) / p.charSims.length,
      syllableSimilarity: p.sylSims.reduce((a, b) => a + b, 0) / p.sylSims.length,
      pages: p.charSims.length,
    }));
  }

  // Save and display
  const filepath = saveResults(`${corpus}-consistency`, results);

  // Print summary
  console.log('\n' + '='.repeat(70));
  console.log(generateConsistencyReport(results));

  if (args.blog) {
    saveBlogPost(corpus, generateConsistencyReport(results));
  }
}

// ── Subcommand: embedding ──────────────────────────────────────────

async function cmdEmbedding() {
  const corpus = args.corpus;
  if (!corpus) { console.error('--corpus required'); process.exit(1); }

  const sampleSize = parseInt(args.sample || '10');

  console.log(`\nEmbedding-Space Evaluation`);
  console.log(`  Corpus: ${corpus}`);
  console.log(`  Sample: ${sampleSize} pages\n`);

  // Sample pages (need both OCR and translation)
  console.log('Sampling pages...');
  const pages = await samplePages(corpus, sampleSize);
  const withBoth = pages.filter(p => p.ocrText && p.translationText);
  console.log(`  Got ${pages.length} pages, ${withBoth.length} with both OCR and translation\n`);

  if (withBoth.length === 0) {
    console.error('No pages with both OCR and translation text found.');
    process.exit(1);
  }

  // Load ground truth if available
  const gtDir = path.join(__dirname, 'ground-truth');
  const humanTranslations = new Map();
  if (fs.existsSync(gtDir)) {
    for (const file of fs.readdirSync(gtDir).filter(f => f.endsWith('.json'))) {
      try {
        const gt = JSON.parse(fs.readFileSync(path.join(gtDir, file), 'utf8'));
        if (gt.translation_ground_truth) {
          humanTranslations.set(`${gt.book_id}-${gt.page_number}`, gt.translation_ground_truth);
        }
      } catch { /* skip */ }
    }
    if (humanTranslations.size > 0) {
      console.log(`  Loaded ${humanTranslations.size} ground truth translations\n`);
    }
  }

  console.log('Computing embeddings...');
  const results = await evaluateCorpus(withBoth, humanTranslations);
  results.corpus = corpus;

  const filepath = saveResults(`${corpus}-embedding`, results);

  console.log('\n' + '='.repeat(70));
  console.log(generateEmbeddingReport(results));

  if (args.blog) {
    saveBlogPost(corpus, generateEmbeddingReport(results));
  }
}

// ── Subcommand: compare (ground truth) ─────────────────────────────

async function cmdCompare() {
  const corpus = args.corpus;
  const against = args.against; // 'ocr' or 'translation'
  if (!corpus) { console.error('--corpus required'); process.exit(1); }
  if (!against || !['ocr', 'translation'].includes(against)) {
    console.error('--against=ocr or --against=translation required');
    process.exit(1);
  }

  const sampleSize = parseInt(args.sample || '10');

  // Load ground truth
  const gtDir = path.join(__dirname, 'ground-truth');
  if (!fs.existsSync(gtDir)) {
    console.error(`No ground truth directory found at ${gtDir}`);
    process.exit(1);
  }

  const groundTruth = new Map();
  for (const file of fs.readdirSync(gtDir).filter(f => f.endsWith('.json'))) {
    try {
      const gt = JSON.parse(fs.readFileSync(path.join(gtDir, file), 'utf8'));
      const key = `${gt.book_id}-${gt.page_number}`;
      groundTruth.set(key, gt);
    } catch { /* skip */ }
  }

  if (groundTruth.size === 0) {
    console.error('No ground truth files found. Add JSON files to scripts/eval/ground-truth/');
    process.exit(1);
  }

  console.log(`\nGround Truth Comparison (${against})`);
  console.log(`  Corpus: ${corpus}`);
  console.log(`  Ground truth entries: ${groundTruth.size}\n`);

  // Sample pages that have ground truth
  const pages = await samplePages(corpus, sampleSize);
  const results = [];

  for (const page of pages) {
    const key = `${page.bookId}-${page.pageNumber}`;
    const gt = groundTruth.get(key);
    if (!gt) continue;

    if (against === 'ocr' && gt.ocr_ground_truth && page.ocrText) {
      const cerScore = cer(page.ocrText, gt.ocr_ground_truth);
      const charSim = charSimilarity(page.ocrText, gt.ocr_ground_truth);
      results.push({
        bookId: page.bookId,
        bookTitle: page.bookTitle,
        pageNumber: page.pageNumber,
        cer: cerScore,
        charSimilarity: charSim,
        source: gt.source,
      });
      console.log(`  ${page.bookTitle} p${page.pageNumber}: CER=${(cerScore * 100).toFixed(1)}% charSim=${(charSim * 100).toFixed(1)}%`);
    }

    if (against === 'translation' && gt.translation_ground_truth && page.translationText) {
      const bleuScore = bleu4(page.translationText, gt.translation_ground_truth, page.script);
      const rougeLScore = rougeL(page.translationText, gt.translation_ground_truth, page.script);
      results.push({
        bookId: page.bookId,
        bookTitle: page.bookTitle,
        pageNumber: page.pageNumber,
        bleu4: bleuScore,
        rougeL: rougeLScore,
        source: gt.translation_source,
      });
      console.log(`  ${page.bookTitle} p${page.pageNumber}: BLEU-4=${bleuScore.toFixed(3)} ROUGE-L=${rougeLScore.toFixed(3)}`);
    }
  }

  if (results.length === 0) {
    console.error('No pages matched ground truth entries.');
    process.exit(1);
  }

  // Summary
  if (against === 'ocr') {
    const avgCer = results.reduce((s, r) => s + r.cer, 0) / results.length;
    const avgCharSim = results.reduce((s, r) => s + r.charSimilarity, 0) / results.length;
    console.log(`\nAvg CER: ${(avgCer * 100).toFixed(1)}%`);
    console.log(`Avg Char Similarity: ${(avgCharSim * 100).toFixed(1)}%`);
  } else {
    const avgBleu = results.reduce((s, r) => s + r.bleu4, 0) / results.length;
    const avgRouge = results.reduce((s, r) => s + r.rougeL, 0) / results.length;
    console.log(`\nAvg BLEU-4: ${avgBleu.toFixed(3)}`);
    console.log(`Avg ROUGE-L: ${avgRouge.toFixed(3)}`);
  }

  saveResults(`${corpus}-compare-${against}`, { corpus, against, results, date: new Date().toISOString().slice(0, 10) });
}

// ── Subcommand: readiness ──────────────────────────────────────────

function computeReadiness(avgMcr, crossModelAgreement) {
  if (avgMcr >= 0.90 && crossModelAgreement >= 0.85) return 'high';
  if (avgMcr >= 0.70 && crossModelAgreement >= 0.70) return 'medium';
  return 'low';
}

async function cmdReadiness() {
  const corpus = args._[1] || args.corpus;
  if (!corpus) { console.error('Usage: qa-eval readiness <corpus>'); process.exit(1); }

  // Check for existing consistency results
  const data = loadLatestResults(`${corpus}-consistency`);
  if (!data) {
    console.log(`No consistency results found for "${corpus}". Run: qa-eval consistency --corpus=${corpus} first`);
    process.exit(1);
  }

  const bestMcr = Math.max(...Object.values(data.summary.byModel).map(s => s.avgMcr));
  const crossModel = data.summary.crossModel?.[0]?.charSimilarity || bestMcr;
  const readiness = computeReadiness(bestMcr, crossModel);

  console.log(`\nCorpus Readiness: ${corpus}`);
  console.log(`  Best MCR: ${(bestMcr * 100).toFixed(1)}%`);
  console.log(`  Cross-model agreement: ${(crossModel * 100).toFixed(1)}%`);
  console.log(`  Readiness: ${readiness.toUpperCase()}`);
}

// ── Subcommand: matrix ─────────────────────────────────────────────

async function cmdMatrix() {
  const registry = loadCorpusRegistry();
  const corporaNames = Object.keys(registry);

  if (corporaNames.length === 0) {
    console.error('No corpora registered. Add entries to scripts/eval/corpus-registry.json');
    process.exit(1);
  }

  console.log(`\nRunning matrix evaluation across ${corporaNames.length} corpora...\n`);

  const corpora = [];
  for (const name of corporaNames) {
    const consistencyData = loadLatestResults(`${name}-consistency`);
    const embeddingData = loadLatestResults(`${name}-embedding`);

    if (!consistencyData) {
      console.log(`  ${name}: no consistency results (run: qa-eval consistency --corpus=${name})`);
      corpora.push({
        name,
        label: registry[name].label,
        script: registry[name].script,
        bestMcr: 0,
        crossModelAgreement: 0,
        embeddingDivergence: null,
        readiness: 'untested',
      });
      continue;
    }

    const bestMcr = Math.max(...Object.values(consistencyData.summary.byModel).map(s => s.avgMcr));
    const crossModel = consistencyData.summary.crossModel?.[0]?.charSimilarity || bestMcr;
    const embDiv = embeddingData?.summary?.meanOcrToTranslation || null;
    const readiness = computeReadiness(bestMcr, crossModel);

    corpora.push({
      name,
      label: registry[name].label,
      script: registry[name].script,
      bestMcr,
      crossModelAgreement: crossModel,
      embeddingDivergence: embDiv,
      readiness,
    });
  }

  const results = {
    corpora,
    meta: { date: new Date().toISOString().slice(0, 10) },
  };

  saveResults('matrix', results);
  console.log('\n' + generateMatrixReport(results));
}

// ── Subcommand: report ─────────────────────────────────────────────

function cmdReport() {
  if (args.latest || !args.corpus) {
    const files = listResults();
    if (files.length === 0) {
      console.log('No results found. Run an evaluation first.');
      return;
    }
    console.log('Available results:');
    for (const f of files) console.log(`  ${f}`);
    return;
  }

  const corpus = args.corpus;
  const format = args.format || 'json';

  // Try consistency first, then embedding
  let data = loadLatestResults(`${corpus}-consistency`);
  let reportType = 'consistency';
  if (!data) {
    data = loadLatestResults(`${corpus}-embedding`);
    reportType = 'embedding';
  }
  if (!data) {
    console.error(`No results found for corpus "${corpus}"`);
    return;
  }

  if (format === 'blog' || format === 'markdown') {
    let md;
    if (reportType === 'consistency') md = generateConsistencyReport(data);
    else md = generateEmbeddingReport(data);

    if (args.save) {
      saveBlogPost(corpus, md);
    } else {
      console.log(md);
    }
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

// ── Main ───────────────────────────────────────────────────────────

const commands = {
  consistency: cmdConsistency,
  'cross-model': cmdConsistency, // cross-model is part of consistency when >1 model
  embedding: cmdEmbedding,
  compare: cmdCompare,
  matrix: cmdMatrix,
  readiness: cmdReadiness,
  report: cmdReport,
};

if (!command || command === 'help') {
  console.log(`
QA-Eval: OCR & Translation Quality Evaluation Framework

Subcommands:
  consistency   Run OCR N times per model, compute MCR and pairwise similarity
  embedding     Embedding-space evaluation (hallucination detection)
  compare       Compare against ground truth (CER, BLEU, ROUGE)
  matrix        Show evaluation matrix across all registered corpora
  readiness     Quick corpus readiness score
  report        Show last results

Common options:
  --corpus=NAME     Corpus from corpus-registry.json (required for most commands)
  --sample=N        Number of pages to sample (default: 10)
  --models=a,b      Comma-separated model aliases: flash, lite, opus, sonnet
  --runs=N          OCR runs per model for consistency (default: 3)
  --delay=MS        Delay between API calls in ms (default: 2000)
  --dry-run         Estimate cost without running
  --blog            Generate markdown blog post
  --book-id=ID      Evaluate a specific book

Examples:
  node scripts/eval/qa-eval.mjs consistency --corpus=bhutan --sample=5 --models=flash,opus --runs=3
  node scripts/eval/qa-eval.mjs embedding --corpus=bhutan --sample=10
  node scripts/eval/qa-eval.mjs compare --corpus=bhutan --against=ocr
  node scripts/eval/qa-eval.mjs readiness bhutan
  node scripts/eval/qa-eval.mjs report --corpus=bhutan --format=blog
  `.trim());
  process.exit(0);
}

const fn = commands[command];
if (!fn) {
  console.error(`Unknown command: ${command}. Run with 'help' for usage.`);
  process.exit(1);
}

try {
  await fn();
} finally {
  await disconnect();
}
