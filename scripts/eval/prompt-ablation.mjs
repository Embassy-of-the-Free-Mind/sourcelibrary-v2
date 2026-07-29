#!/usr/bin/env node
/**
 * Prompt ablation: does asking a VLM for structured metadata alongside the
 * transcription degrade the transcription — and do required fields actually fire?
 *
 * Motivation (#3444). Three difficulty signals in the live OCR prompt are OPTIONAL,
 * and measured across 4,000 OCR'd pages none of them fire: <script> 7.3%,
 * <warning> 3.8%, pages.scan_quality 1.5%. The occlusion pilot found the same
 * shape at its sharpest — 1 of 28 runs mentioned a mask covering 25% of the page
 * (.claude/docs/ocr-memorization-paper.md, result 13). The proposed fix makes a
 * page-conditions checklist REQUIRED. Before shipping that we need to know what it
 * costs in transcription accuracy, because a prompt edit is cheap to write and
 * expensive to validate, and a plausible non-fix is worse than no fix (#3418).
 *
 * The paper plan lists this as an open contribution: "the effect of
 * annotation-format prompts on OCR character accuracy — the dossier found no
 * existing study; unclaimed territory worth a subsection."
 *
 * ARMS (per page × model)
 *   A  transcribe-only        bare transcription, no tags        → accuracy ceiling
 *   B  current                the live production prompt         → today's baseline
 *   C  required-conditions    B + provenance grouping + required <page-conditions>
 *   D  two-call               A for text, then D2 for conditions → interference control
 *
 * A vs C isolates the accuracy cost of the intervention. B vs C isolates whether
 * required beats optional for flag firing. C vs D isolates task interference:
 * if C's accuracy < D's, one call is doing two jobs badly and the second call is
 * worth its ~63% input surcharge (the page image dominates the input, so a second
 * call nearly doubles input tokens — see the pre-registration).
 *
 * Every arm is scored on the SAME pinned ground-truth passages the scorecard uses,
 * so accuracy numbers are comparable to every prior run.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/prompt-ablation.mjs --dry-run --models=lite,flash --only=latin
 *   node scripts/eval/prompt-ablation.mjs --models=lite,flash --runs=2 --only=latin
 *
 *   --models=a,b     model aliases (lite=3.1-flash-lite, lite35=3.5-flash-lite,
 *                    flash=3-flash-preview, flash36=3.6-flash)
 *   --arms=A,B,C,D   which arms to run (default all)
 *   --only=<regex>   restrict ground-truth files (the paid part — scope it)
 *   --runs=N         runs per page × arm × model (default 1)
 *   --occlude=x,y,w,h  mask a normalized rect — the flag-firing test
 *   --width=N        resize before sending (keep constant across arms)
 *   --delay=MS       throttle between calls
 *   --dry-run        cost estimate only, no API calls
 *
 * Raw outputs append to results/ablation-outputs-<date>.jsonl and are the durable
 * artifact — scoring can be redone offline, model calls cannot.
 */

import { loadEnv, getPage, disconnect } from './lib/sampling.mjs';
import { runModel, resolveModel, fetchImage } from './lib/runners.mjs';
import { scoreAgainstReference } from './lib/metrics.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv();

function parseArgs(argv) {
  const out = { _: [] };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      out[k] = v === undefined ? true : v;
    } else out._.push(a);
  }
  return out;
}
const args = parseArgs(process.argv);

const PROMPT_DIR = path.join(__dirname, 'prompts', 'ablation');
const ARMS = {
  A: { label: 'transcribe-only', prompt: 'A-transcribe-only.txt' },
  B: { label: 'current', prompt: 'B-current.txt' },
  C: { label: 'required-conditions', prompt: 'C-required-conditions.txt' },
  D: { label: 'two-call', prompt: 'A-transcribe-only.txt', second: 'D2-classify-only.txt' },
};

// Closed vocabulary from the C/D2 prompts. Terms that never fire, or that fire
// without predicting disagreement, get cut before this ships — see the
// pre-registration. Kept here so the parser and the prompts cannot drift apart
// silently: parseConditions warns on any term the prompts did not offer.
const CONDITION_VOCAB = new Set([
  'handwritten', 'mixed-hand', 'fraktur', 'blackletter', 'rashi-script', 'non-latin-script',
  'faded-ink', 'bleed-through', 'stain', 'tear', 'worm-damage', 'water-damage',
  'gutter-loss', 'skew', 'obscured', 'overstamp', 'microfilm',
  'marginalia', 'tabular', 'multi-column',
]);

/**
 * Extract the structured signals from a model's raw output.
 *
 * `conditionsPresent` distinguishes "the model emitted the required field" from
 * "the field said none" — the whole point of a mandatory assertion is that
 * silence and a negative answer stop being the same output.
 */
function parseSignals(text) {
  const tag = (name) => {
    const m = text.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'));
    return m ? m[1].trim() : null;
  };
  const rawConditions = tag('page-conditions');
  let conditions = null, unknownTerms = [];
  if (rawConditions !== null) {
    const terms = rawConditions.toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    if (terms.length === 1 && terms[0] === 'none') conditions = [];
    else {
      conditions = terms.filter(t => CONDITION_VOCAB.has(t));
      unknownTerms = terms.filter(t => t !== 'none' && !CONDITION_VOCAB.has(t));
    }
  }
  return {
    conditionsPresent: rawConditions !== null,
    conditions,
    unknownTerms,
    script: tag('script'),
    warning: tag('warning'),
    // Counting tags, not just presence: a page whose marginalia the model
    // ASSERTS but does not transcribe is a self-contradictory output, and that
    // contradiction is checkable at write time without any ground truth.
    marginTags: (text.match(/<margin>/gi) || []).length,
    glossTags: (text.match(/<gloss>/gi) || []).length,
    insertTags: (text.match(/<insert>/gi) || []).length,
    noteTags: (text.match(/<note>/gi) || []).length,
    // Free-prose mention of a mask, for comparability with the occlusion pilot's
    // 1-of-28 baseline, which predates any structured field.
    mentionsMask: /\b(obscur|mask|cover(ed|s)? (the|part|a portion)|grey box|gray box|blank (band|block|rectangle)|illegible (band|region|block))/i.test(text),
  };
}

/** Strip annotation tags so tagged and untagged arms are scored on like for like. */
function stripTagsForScoring(text) {
  return text
    .replace(/<(page-conditions|script|warning|language|page-type|page-num|header|sig|meta|vocab|columns|scan-quality)>[\s\S]*?<\/\1>/gi, '')
    .replace(/<detected-images>[\s\S]*?<\/detected-images>/gi, '')
    .replace(/<\/?(margin|gloss|insert|unclear|note|term|image-desc|column-break)\s*\/?>/gi, '')
    .trim();
}

async function main() {
  const gtDir = path.join(__dirname, 'ground-truth');
  const only = typeof args.only === 'string' ? new RegExp(args.only, 'i') : null;
  const entries = [];
  for (const file of fs.readdirSync(gtDir).filter(f => f.endsWith('.json'))) {
    if (only && !only.test(file)) continue;
    try {
      const gt = JSON.parse(fs.readFileSync(path.join(gtDir, file), 'utf8'));
      if (gt.ocr_ground_truth) entries.push({ ...gt, _file: file });
    } catch { /* skip malformed */ }
  }
  if (!entries.length) { console.error('No ground-truth files matched.'); process.exit(1); }

  const models = (args.models || 'lite').split(',').map(resolveModel);
  const armKeys = (args.arms || 'A,B,C,D').split(',').map(s => s.trim().toUpperCase());
  const runs = parseInt(args.runs || '1');

  const prompts = {};
  for (const k of armKeys) {
    if (!ARMS[k]) { console.error(`Unknown arm ${k}`); process.exit(1); }
    prompts[k] = fs.readFileSync(path.join(PROMPT_DIR, ARMS[k].prompt), 'utf8');
    if (ARMS[k].second) prompts[`${k}2`] = fs.readFileSync(path.join(PROMPT_DIR, ARMS[k].second), 'utf8');
  }

  // Calls per page: one per arm, plus a second for any two-call arm.
  const callsPerPageRun = armKeys.reduce((n, k) => n + (ARMS[k].second ? 2 : 1), 0);
  const totalCalls = entries.length * models.length * runs * callsPerPageRun;

  // Estimate from MEASURED medians rather than the library's generic 1500/2000
  // guess: gemini_usage single-page OCR runs 3,272 input / 444 output (median,
  // n=1500). Input is 7.4x output and the page image dominates it, which is
  // exactly why arm D is expensive.
  const PRICING = {
    'gemini-3.1-flash-lite': { input: 0.075, output: 0.30 },
    'gemini-3.5-flash-lite': { input: 0.30, output: 2.50 },
    'gemini-3-flash-preview': { input: 0.50, output: 3.00 },
    'gemini-3.6-flash': { input: 1.50, output: 7.50 },
    'gemini-3.1-pro-preview': { input: 2.50, output: 15.00 },
  };
  const IN_TOK = 3272, OUT_TOK = 444, OUT_TOK_CLASSIFY = 40;

  console.log(`\nPrompt ablation — ${entries.length} pinned passages × ${models.length} model(s) × arms [${armKeys.join(',')}] × ${runs} run(s)`);
  console.log(`  ${totalCalls} model calls total\n`);
  let grandTotal = 0;
  for (const model of models) {
    const p = PRICING[model] || { input: 0.50, output: 3.00 };
    let usd = 0;
    for (const k of armKeys) {
      usd += entries.length * runs * (IN_TOK / 1e6 * p.input + OUT_TOK / 1e6 * p.output);
      if (ARMS[k].second) usd += entries.length * runs * (IN_TOK / 1e6 * p.input + OUT_TOK_CLASSIFY / 1e6 * p.output);
    }
    grandTotal += usd;
    console.log(`  ${model.padEnd(26)} ~$${usd.toFixed(2)}`);
  }
  console.log(`  ${'TOTAL'.padEnd(26)} ~$${grandTotal.toFixed(2)}\n`);
  if (args['dry-run']) { console.log('  (dry run — no API calls made)\n'); await disconnect(); return; }

  const outFile = path.join(__dirname, 'results', `ablation-outputs-${new Date().toISOString().slice(0, 10)}.jsonl`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const rows = [];

  for (const gt of entries) {
    const page = await getPage(gt.book_id, gt.page_number);
    const imageUrl = page && getPageSource(page);
    if (!imageUrl) { console.log(`  ! ${gt.work}: no usable page image, skipping`); continue; }
    let imageBuffer = await fetchImage(imageUrl);
    let armSuffix = '';

    // Image manipulations apply identically to every arm, so an arm difference is
    // never a difference in what the model was shown.
    if (args.width) {
      const sharp = (await import('sharp')).default;
      const meta = await sharp(imageBuffer).metadata();
      if (meta.width > parseInt(args.width)) {
        imageBuffer = await sharp(imageBuffer).resize({ width: parseInt(args.width) }).jpeg({ quality: 90 }).toBuffer();
      }
      armSuffix += `@w${args.width}`;
    }
    if (args.occlude) {
      const sharp = (await import('sharp')).default;
      const meta = await sharp(imageBuffer).metadata();
      const [xf, yf, wf, hf] = args.occlude.split(',').map(Number);
      const band = await sharp({ create: {
        width: Math.round(meta.width * wf), height: Math.round(meta.height * hf),
        channels: 3, background: { r: 120, g: 120, b: 120 } } }).jpeg().toBuffer();
      // Materialize the composite BEFORE any resize — sharp's composite().resize()
      // in one chain silently shifts the mask via JPEG shrink-on-load (recorded in
      // the occlusion v2 tooling note).
      imageBuffer = await sharp(imageBuffer)
        .composite([{ input: band, top: Math.round(meta.height * yf), left: Math.round(meta.width * xf) }])
        .jpeg({ quality: 90 }).toBuffer();
      armSuffix += `@occR${Math.round(wf * hf * 100)}`;
    }

    for (const model of models) {
      for (const k of armKeys) {
        for (let i = 0; i < runs; i++) {
          if (args.delay) await new Promise(r => setTimeout(r, parseInt(args.delay)));
          try {
            const res = await runModel(model, imageBuffer, prompts[k], { maxTokens: 16000 });
            let signals = parseSignals(res.text);
            let cost = res.costUsd, secondText = null;

            // Arm D: the transcription call carries no metadata request at all, so
            // its signals must come from a second call on the same image.
            if (ARMS[k].second) {
              if (args.delay) await new Promise(r => setTimeout(r, parseInt(args.delay)));
              const res2 = await runModel(model, imageBuffer, prompts[`${k}2`], { maxTokens: 2000 });
              cost += res2.costUsd;
              secondText = res2.text;
              const s2 = parseSignals(res2.text);
              // Transcription-side tag counts stay from call 1 (there are none);
              // the classification signals come from call 2.
              signals = { ...signals, ...s2, marginTags: signals.marginTags, glossTags: signals.glossTags,
                          insertTags: signals.insertTags, noteTags: signals.noteTags };
            }

            const score = scoreAgainstReference(gt.ocr_ground_truth, stripTagsForScoring(res.text), gt.script || 'cjk');
            const row = {
              work: gt.work, slug: gt._file.replace(/\.json$/, ''), script: gt.script,
              canonical: gt.page_class?.canonical_text ?? null,
              model, arm: k, armLabel: ARMS[k].label, armSuffix, run: i + 1,
              finishReason: res.finishReason,
              aligned: score.aligned,
              charAccuracy: score.aligned ? score.charAccuracy : null,
              cer: score.aligned ? score.cer : null,
              refChars: score.refLen,
              costUsd: cost,
              ...signals,
            };
            rows.push(row);
            fs.appendFileSync(outFile, JSON.stringify({ ...row, text: res.text, secondText }) + '\n');

            const acc = row.charAccuracy === null ? '  n/a' : (row.charAccuracy * 100).toFixed(1) + '%';
            const cond = signals.conditionsPresent
              ? (signals.conditions.length ? signals.conditions.join('|').slice(0, 30) : 'none')
              : '\x1b[31mMISSING\x1b[0m';
            console.log(`  ${gt.work.slice(0, 24).padEnd(24)} ${model.slice(0, 22).padEnd(22)} ${k} acc=${acc.padStart(6)}  cond=${cond}`);
          } catch (e) {
            console.log(`  ! ${gt.work} × ${model} × ${k} run ${i + 1}: ${String(e.message).slice(0, 110)}`);
          }
        }
      }
    }
  }

  const summaryFile = path.join(__dirname, 'results', `ablation-summary-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(summaryFile, JSON.stringify({
    date: new Date().toISOString(),
    models, arms: armKeys, runs, only: args.only || null,
    occlude: args.occlude || null, width: args.width || null,
    rows,
  }, null, 2));

  console.log(`\n  Raw outputs → ${path.relative(process.cwd(), outFile)}`);
  console.log(`  Summary     → ${path.relative(process.cwd(), summaryFile)}`);
  console.log(`  Analyse     → node scripts/eval/report-ablation.mjs ${path.relative(process.cwd(), summaryFile)}\n`);
  await disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
