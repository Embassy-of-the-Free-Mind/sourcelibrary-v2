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

import { loadEnv, samplePages, getPage, disconnect, loadCorpusRegistry } from './lib/sampling.mjs';
import { runModel, resolveModel, fetchImage, estimateCost } from './lib/runners.mjs';
import { mcr, pairwiseMetrics, charSimilarity, syllableSimilarity, cleanText, cer, bleu4, rougeL, subsequenceCER, scoreAgainstReference, normalizeCJK, normalizeForScript } from './lib/metrics.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';
import { saveResults, loadLatestResults, listResults, generateConsistencyReport, generateEmbeddingReport, generateMatrixReport, saveBlogPost } from './lib/report.mjs';
import { evaluateCorpus, evaluateRunConsistency } from './lib/embedding-eval.mjs';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
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

  const gtDir = path.join(__dirname, 'ground-truth');
  if (!fs.existsSync(gtDir)) {
    console.error(`No ground truth directory found at ${gtDir}`);
    process.exit(1);
  }

  // Scope ground truth to the corpus's script so a Chinese run ignores e.g. Tibetan GT.
  // An unknown corpus must FAIL here: an undefined script would silently disable the
  // filter and aggregate every language's ground truth into one bogus number.
  const registry = loadCorpusRegistry();
  if (!registry[corpus]) {
    console.error(`Unknown corpus "${corpus}". Known: ${Object.keys(registry).join(', ')}`);
    process.exit(1);
  }
  const corpusScript = registry[corpus].script;
  const entries = [];
  for (const file of fs.readdirSync(gtDir).filter(f => f.endsWith('.json'))) {
    try {
      const gt = JSON.parse(fs.readFileSync(path.join(gtDir, file), 'utf8'));
      if (corpusScript && gt.script && gt.script !== corpusScript) continue;
      entries.push(gt);
    } catch { /* skip */ }
  }

  if (entries.length === 0) {
    console.error('No matching ground truth files. Add JSON files to scripts/eval/ground-truth/');
    process.exit(1);
  }

  console.log(`\nGround Truth Comparison (${against})`);
  console.log(`  Corpus: ${corpus}  |  Ground truth entries: ${entries.length}\n`);

  // Above this subsequence-CER, the reference isn't cleanly present in the page —
  // i.e. wrong page/book or a divergent recension, not a salvageable OCR read.
  const DIVERGENCE = parseFloat(args.threshold || '0.30');
  const results = [];

  for (const gt of entries) {
    // Fetch the EXACT pinned book+page. Pinning by id is the book-identity guard —
    // no fuzzy title matching that could grab a same-phrase decoy.
    const page = await getPage(gt.book_id, gt.page_number);
    const label = gt.work || gt.book_id;
    if (!page) { console.log(`  - ${label}: page not found (${gt.book_id} p${gt.page_number})`); continue; }
    const ocrText = page.ocr?.data || null;
    const translationText = page.translation?.data || null;
    const script = corpusScript || 'default';

    if (against === 'ocr' && gt.ocr_ground_truth && ocrText) {
      // Script-aware two-stage scoring: word-level identity guard for alphabetic
      // scripts, char-level for cjk; char-CER inside the verified window.
      const r = scoreAgainstReference(gt.ocr_ground_truth, ocrText, gt.script || 'cjk',
        { cjk: DIVERGENCE, word: parseFloat(args['word-threshold'] || '0.35') });
      const { cer: score, refLen, matched, aligned } = r;
      results.push({
        work: label, bookId: gt.book_id, pageNumber: gt.page_number,
        cer: score, charAccuracy: 1 - score, refLen, matched, aligned,
        source: gt.source, source_url: gt.source_url,
      });
      console.log(`  ${aligned ? 'OK ' : 'XX '} ${label.padEnd(22)} CER=${(score * 100).toFixed(1).padStart(5)}%  acc=${((1 - score) * 100).toFixed(1).padStart(5)}%  (ref ${refLen})${aligned ? '' : '  [unalignable: wrong page / divergent recension]'}`);
    }

    if (against === 'translation' && gt.translation_ground_truth && translationText) {
      const bleuScore = bleu4(translationText, gt.translation_ground_truth, script);
      const rougeLScore = rougeL(translationText, gt.translation_ground_truth, script);
      results.push({
        work: label, bookId: gt.book_id, pageNumber: gt.page_number,
        bleu4: bleuScore, rougeL: rougeLScore, source: gt.translation_source,
      });
      console.log(`  ${label}: BLEU-4=${bleuScore.toFixed(3)} ROUGE-L=${rougeLScore.toFixed(3)}`);
    }
  }

  if (results.length === 0) {
    console.error('No pages matched ground truth entries.');
    process.exit(1);
  }

  if (against === 'ocr') {
    const aligned = results.filter(r => r.aligned);
    const totalRef = aligned.reduce((s, r) => s + r.refLen, 0);
    const charAcc = totalRef ? aligned.reduce((s, r) => s + r.matched, 0) / totalRef : 0;
    console.log(`\n  Cleanly aligned: ${aligned.length}/${results.length}`);
    console.log(`  Char-weighted OCR accuracy: ${(charAcc * 100).toFixed(2)}%  (CER ${((1 - charAcc) * 100).toFixed(2)}%)`);
    const excluded = results.filter(r => !r.aligned);
    if (excluded.length) console.log(`  Excluded (>${(DIVERGENCE * 100).toFixed(0)}% — wrong page / divergent recension, NOT an OCR failure): ${excluded.map(r => r.work).join(', ')}`);
    console.log(`  Note: ctext covers canonical PRINTED texts only — manuscripts, tables and rare works are out of scope for this metric.`);
  } else {
    const avgBleu = results.reduce((s, r) => s + r.bleu4, 0) / results.length;
    const avgRouge = results.reduce((s, r) => s + r.rougeL, 0) / results.length;
    console.log(`\nAvg BLEU-4: ${avgBleu.toFixed(3)}`);
    console.log(`Avg ROUGE-L: ${avgRouge.toFixed(3)}`);
  }

  saveResults(`${corpus}-compare-${against}`, { corpus, against, results, date: new Date().toISOString().slice(0, 10) });
}

// ── Subcommand: scorecard (per-language OCR quality vs published texts) ──

async function cmdScorecard() {
  const gtDir = path.join(__dirname, 'ground-truth');
  if (!fs.existsSync(gtDir)) { console.error(`No ground truth at ${gtDir}`); process.exit(1); }
  // --only=<regex> restricts to matching ground-truth filenames (e.g.
  // --only=tibetan, --only='eznik|vita-vergilii') so new-passage model runs —
  // the paid part — don't re-spend on the whole set. Plain substrings work too.
  const only = typeof args.only === 'string' ? args.only : null;
  const onlyRx = only ? new RegExp(only, 'i') : null;
  const entries = [];
  for (const file of fs.readdirSync(gtDir).filter(f => f.endsWith('.json'))) {
    if (onlyRx && !onlyRx.test(file)) continue;
    try {
      const gt = JSON.parse(fs.readFileSync(path.join(gtDir, file), 'utf8'));
      if (gt.ocr_ground_truth) entries.push(gt);
    } catch { /* skip */ }
  }
  if (!entries.length) { console.error(`No OCR ground-truth files${only ? ` matching --only=${only}` : ''}.`); process.exit(1); }

  // Optional model comparison: re-OCR each pinned page with each model and score
  // against the same reference. Costs API money — always honor --dry-run.
  const models = args.models ? args.models.split(',').map(resolveModel) : [];
  const runs = parseInt(args.runs || '1');
  if (args['dry-run'] && models.length) {
    console.log(`\nCost estimate: ${entries.length} pages × ${runs} run(s) each:`);
    let total = 0;
    for (const model of models) {
      const est = estimateCost(model, runs, entries.length);
      total += est.estimatedUsd;
      console.log(`  ${model.padEnd(30)} ${est.calls} calls  ~$${est.estimatedUsd.toFixed(2)}`);
    }
    console.log(`  TOTAL ~$${total.toFixed(2)}`);
    return;
  }

  console.log(`\nOCR Quality Scorecard — ${entries.length} reference passages vs published texts\n`);

  const byLang = new Map();
  for (const gt of entries) {
    const page = await getPage(gt.book_id, gt.page_number);
    const label = `${gt.language || gt.script}`;
    if (!byLang.has(label)) byLang.set(label, { script: gt.script, rows: [] });
    if (!page?.ocr?.data) {
      byLang.get(label).rows.push({ work: gt.work, missing: true });
      continue;
    }
    const r = scoreAgainstReference(gt.ocr_ground_truth, page.ocr.data, gt.script || 'cjk');
    const row = {
      work: gt.work, bookId: gt.book_id, pageNumber: gt.page_number,
      aligned: r.aligned, guard: r.guard.value, cer: r.cer,
      charAccuracy: r.charAccuracy, refLen: r.refLen, matched: r.matched,
      source: gt.source, source_url: gt.source_url,
    };
    byLang.get(label).rows.push(row);

    if (models.length) {
      // Same image source the pipeline OCR'd (getPageSource handles split pages).
      const imageUrl = getPageSource(page);
      if (!imageUrl) { console.log(`  ! ${gt.work}: no usable page image, skipping model runs`); continue; }
      let imageBuffer = await fetchImage(imageUrl);
      // --width=N resizes the image before sending (resolution-ablation arm).
      // --tag=STR labels an experimental arm (e.g. annotated-prompt). Both are
      // recorded as a @suffix on the model field in the raw-outputs JSONL so
      // build-observations keeps arms separate from baseline runs.
      let armSuffix = typeof args.tag === 'string' ? `@${args.tag}` : '';
      if (args.width) {
        const width = parseInt(args.width);
        const sharp = (await import('sharp')).default;
        const meta = await sharp(imageBuffer).metadata();
        if (meta.width > width) imageBuffer = await sharp(imageBuffer).resize({ width }).jpeg({ quality: 90 }).toBuffer();
        armSuffix = `@w${width}${armSuffix}`;
        console.log(`  resized to ${Math.min(width, meta.width)}px wide (native ${meta.width}) → ${imageBuffer.length} bytes`);
      }
      // --blur=SIGMA gaussian-blurs the (possibly resized) image — degradation-
      // robustness arm: reading needs pixels, reciting does not, so accuracy that
      // survives blur is a memory signature. Apply AFTER --width so sigma is
      // comparable across pages at a fixed pixel scale.
      if (args.blur) {
        const sigma = parseFloat(args.blur);
        const sharp = (await import('sharp')).default;
        imageBuffer = await sharp(imageBuffer).blur(sigma).jpeg({ quality: 90 }).toBuffer();
        armSuffix = `@blur${sigma}${armSuffix}`;
        console.log(`  blurred σ=${sigma} → ${imageBuffer.length} bytes`);
      }
      // --occlude=FRAC masks a horizontal band (FRAC of image height, centered
      // vertically, margins left visible so layout parsing survives). Text the
      // model emits for the masked band is reference-free evidence of recitation
      // (occlusion cloze — see ocr-memorization-paper.md).
      //
      // --occlude=x,y,w,h (four comma-separated fractions of width/height) masks
      // a normalized RECT instead — a passage-TARGETED mask, chosen per page by
      // visually locating the reference passage rather than a fixed mid-page
      // band. This is the v2 pilot correction (result 16 in
      // ocr-memorization-paper.md): the v1 fixed band missed the reference
      // passage entirely on 2 of 5 canonical pages. Arm-tagged `@occR<pct>`
      // where pct is the RECT'S AREA SHARE of the page (w*h*100) — distinct from
      // the old `@occ<pct>` (height-fraction of the old band form) so v1/v2 runs
      // never collide in the observations dataset.
      if (args.occlude) {
        const sharp = (await import('sharp')).default;
        const meta = await sharp(imageBuffer).metadata();
        if (args.occlude.includes(',')) {
          const [xf, yf, wf, hf] = args.occlude.split(',').map(Number);
          const left = Math.round(meta.width * xf);
          const top = Math.round(meta.height * yf);
          const bandW = Math.round(meta.width * wf);
          const bandH = Math.round(meta.height * hf);
          const band = await sharp({ create: { width: bandW, height: bandH, channels: 3, background: { r: 120, g: 120, b: 120 } } }).jpeg().toBuffer();
          imageBuffer = await sharp(imageBuffer).composite([{ input: band, top, left }]).jpeg({ quality: 90 }).toBuffer();
          const areaPct = Math.round(wf * hf * 100);
          armSuffix = `@occR${areaPct}${armSuffix}`;
          console.log(`  occluded rect ${bandW}×${bandH} at (${left},${top}) [area ${areaPct}%] → ${imageBuffer.length} bytes`);
        } else {
          const frac = parseFloat(args.occlude);
          const bandH = Math.round(meta.height * frac);
          const top = Math.round(meta.height / 2 - bandH / 2);
          const left = Math.round(meta.width * 0.10);
          const bandW = Math.round(meta.width * 0.80);
          const band = await sharp({ create: { width: bandW, height: bandH, channels: 3, background: { r: 120, g: 120, b: 120 } } }).jpeg().toBuffer();
          imageBuffer = await sharp(imageBuffer).composite([{ input: band, top, left }]).jpeg({ quality: 90 }).toBuffer();
          armSuffix = `@occ${Math.round(frac * 100)}${armSuffix}`;
          console.log(`  occluded ${bandW}×${bandH} band at y=${top} → ${imageBuffer.length} bytes`);
        }
      }
      // --save-image=DIR dumps the manipulated image for visual audit of arm placement.
      if (args['save-image']) {
        const name = (gt.work || 'page').replace(/\W+/g, '_').slice(0, 60) + armSuffix.replace(/@/g, '_') + '.jpg';
        fs.writeFileSync(path.join(args['save-image'], name), imageBuffer);
      }
      row.models = {};
      for (const model of models) {
        const outputs = [];
        let cost = 0, best = null, refused = 0;
        for (let i = 0; i < runs; i++) {
          // --delay=MS throttles between model calls — free-tier endpoints
          // (Gemma) drop consecutive rapid requests with bare fetch failures.
          if (args.delay) await new Promise(r => setTimeout(r, parseInt(args.delay)));
          try {
            // Pass the source URL only when the buffer is unmodified — width-resized
            // arms must not leak the full-res URL to URL-preferring runners.
            const res = await runModel(model, imageBuffer, args.prompt || DEFAULT_PROMPT, { maxTokens: 16000, ...(args.width ? {} : { imageUrl }) });
            cost += res.costUsd;
            // Raw outputs are dumped so runs can be RE-scored offline when
            // normalization improves — model calls are the expensive part.
            fs.appendFileSync(path.join(__dirname, 'results', `scorecard-outputs-${new Date().toISOString().slice(0, 10)}.jsonl`),
              JSON.stringify({ work: gt.work, model: model + armSuffix, run: i + 1, finishReason: res.finishReason, text: res.text }) + '\n');
            if (res.finishReason === 'refusal') { refused++; continue; }
            const score = scoreAgainstReference(gt.ocr_ground_truth, res.text, gt.script || 'cjk');
            outputs.push({ text: res.text, score });
            if (!best || score.cer < best.cer) best = score;
          } catch (e) {
            console.log(`  ! ${gt.work} × ${model} run ${i + 1}: ${e.message.slice(0, 120)}`);
          }
        }
        // Consistency: MCR over normalized outputs (identical normalized text = same run).
        const norm = t => gt.script === 'cjk' ? normalizeCJK(t) : normalizeForScript(t, gt.script);
        const consistency = outputs.length > 1 ? mcr(outputs.map(o => norm(o.text))).rate : null;
        row.models[model] = {
          runs: outputs.length, refused, costUsd: cost, consistency,
          aligned: best?.aligned ?? false,
          charAccuracy: best?.aligned ? best.charAccuracy : null,
          cer: best?.aligned ? best.cer : null,
        };
        const m = row.models[model];
        console.log(`  ${gt.work.padEnd(28)} ${model.padEnd(28)} acc=${m.charAccuracy === null ? '  n/a' : (m.charAccuracy * 100).toFixed(1) + '%'}  ${consistency === null ? '' : `MCR=${(consistency * 100).toFixed(0)}%`}${refused ? `  refused=${refused}` : ''}  $${cost.toFixed(3)}`);
      }
    }
  }

  const summary = [];
  console.log(`  ${'Language'.padEnd(12)} ${'Script'.padEnd(10)} ${'Passages'.padStart(8)} ${'Aligned'.padStart(7)} ${'Ref chars'.padStart(9)} ${'Accuracy'.padStart(9)}`);
  console.log('  ' + '─'.repeat(60));
  for (const [lang, { script, rows }] of [...byLang.entries()].sort()) {
    const scored = rows.filter(r => !r.missing);
    const aligned = scored.filter(r => r.aligned);
    const totalRef = aligned.reduce((s, r) => s + r.refLen, 0);
    const acc = totalRef ? aligned.reduce((s, r) => s + r.matched, 0) / totalRef : null;
    summary.push({ language: lang, script, passages: scored.length, aligned: aligned.length, refChars: totalRef, charAccuracy: acc, rows });
    console.log(`  ${lang.padEnd(12)} ${script.padEnd(10)} ${String(scored.length).padStart(8)} ${String(aligned.length).padStart(7)} ${String(totalRef).padStart(9)} ${acc === null ? '      n/a' : ((acc * 100).toFixed(1) + '%').padStart(9)}`);
    for (const r of rows) {
      if (r.missing) { console.log(`      - ${r.work}: page missing`); continue; }
      if (!r.aligned) console.log(`      - ${r.work}: guard ${(r.guard * 100).toFixed(0)}% — excluded (not cleanly present; NOT an OCR failure)`);
    }
  }
  if (models.length) {
    console.log(`\n  Model comparison (best-of-${runs} char accuracy on aligned passages, vs stored pipeline OCR):`);
    console.log(`  ${'Model'.padEnd(30)} ${'Aligned'.padStart(7)} ${'Accuracy'.padStart(9)} ${'Mean MCR'.padStart(9)} ${'Cost'.padStart(8)}`);
    const allRows = [...byLang.values()].flatMap(l => l.rows).filter(r => r.models);
    for (const model of models) {
      const ms = allRows.map(r => r.models[model]).filter(Boolean);
      const aligned = ms.filter(m => m.aligned);
      const refTotal = allRows.filter(r => r.models[model]?.aligned).reduce((s, r) => s + r.refLen, 0);
      const matched = allRows.filter(r => r.models[model]?.aligned).reduce((s, r) => s + r.refLen * r.models[model].charAccuracy, 0);
      const cons = ms.map(m => m.consistency).filter(c => c !== null);
      const cost = ms.reduce((s, m) => s + m.costUsd, 0);
      console.log(`  ${model.padEnd(30)} ${`${aligned.length}/${ms.length}`.padStart(7)} ${refTotal ? ((matched / refTotal) * 100).toFixed(1) + '%' : 'n/a'.padStart(4)}`.padEnd(52)
        + ` ${cons.length ? (cons.reduce((s, c) => s + c, 0) / cons.length * 100).toFixed(0) + '%' : 'n/a'}`.padStart(9)
        + ` $${cost.toFixed(2)}`.padStart(8));
    }
  }

  console.log(`\n  Coverage note: reference etexts exist for canonical texts — this measures OCR`);
  console.log(`  on clean canonical pages. Manuscripts and rare works (the OCR frontier) are`);
  console.log(`  covered by consistency/cross-model/embedding checks, not this scorecard.`);

  // Scoped runs save under their own name — saveResults keys the filename on
  // kind+date alone, so an --only run would otherwise clobber the full scorecard.
  // Long --only regexes must be truncated (a many-slug alternation once blew
  // past NAME_MAX and ENAMETOOLONG'd after all paid calls had completed); a
  // short hash keeps distinct scopes from colliding. The full regex is still
  // recorded in the JSON body's `only` field.
  let scope = '';
  if (only) {
    const slug = only.replace(/[^a-z0-9._-]+/gi, '-');
    const hash = createHash('sha256').update(only).digest('hex').slice(0, 8);
    scope = `-${slug.length > 60 ? `${slug.slice(0, 60)}-${hash}` : slug}`;
  }
  saveResults(`scorecard${scope}`, { date: new Date().toISOString().slice(0, 10), models, runs: models.length ? runs : undefined, only: only || undefined, summary });
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
  scorecard: cmdScorecard,
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
  scorecard     Per-language OCR accuracy vs published reference texts (#3212)
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
  --only=REGEX      scorecard: only ground-truth files whose filename matches
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
