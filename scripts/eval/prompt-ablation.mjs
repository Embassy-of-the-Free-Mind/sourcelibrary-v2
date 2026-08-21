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

import { loadEnv, getPage, disconnect, connect } from './lib/sampling.mjs';
import { getProductionOcrPrompt } from './lib/production-prompt.mjs';
import { runModel, resolveModel, fetchImage } from './lib/runners.mjs';
import { scoreAgainstReference } from './lib/metrics.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { priceFor } from '../lib/model-pricing.mjs';

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

// ── Page grouping (factor 2) ─────────────────────────────────────────
//
// OCR sends ONE image per call in production (pipeline-orchestrator.mjs:1655);
// the 20/1000/250 constants bundle REQUESTS into a batch job and never put two
// pages in a prompt. Translation is the opposite — 8 pages per call plus the
// previous page's translation for continuity. So OCR alone has no cross-page
// context, and a marginal note running over a page break, a hyphenated word
// split across a leaf, a continuing table, or a running header seen 200 times
// are all invisible to it. Ars Astronomica groups 4 pages for exactly this
// reason. This factor tests whether that helps.
//
// The target page goes LAST, preceded by its real predecessors from the same
// book, so the model has the maximum prior context the mechanism could use.
// The model transcribes ALL pages (the deployable form — cost amortizes) and
// only the target is scored, so segmentation reliability becomes its own
// outcome: if page boundaries can't be delimited, grouping is unusable
// regardless of what it does to accuracy.
// Delimiting convention copied from the PRODUCTION translation batcher
// (translate-worker.mjs:369) rather than invented here. It asks for LABELLED tags
// — `<page n="491">…</page>` — not a bare separator, and the difference is a
// correctness one: a bare delimiter can only count segments, so a model that
// renumbers or REORDERS pages would have its wrong segment scored against the
// target's ground truth with nothing to catch it. A labelled tag is
// self-identifying, so the scorer can assert it holds the page it thinks it does.
//
// Two failure modes the translation batcher learned the hard way, both recorded
// here as outcomes rather than silently repaired:
//   1. Models renumber pages (emitting 1..N instead of the real page numbers) —
//      production falls back to POSITION when the count matches exactly.
//   2. Short pages make the model skip the tags altogether and emit garbage —
//      production refuses to batch when the first page's OCR is under
//      MIN_OCR_CHARS_FOR_BATCH.
const PAGE_TAG_RE = /<page\s+n="(\d+)">([\s\S]*?)<\/page>/g;

// Only the prompt-factor arms are crossed with grouping. A (bare ceiling) and D
// (two-call control) stay ungrouped so they mean the same thing in every cell.
const FACTORIAL_ARMS = new Set(['B', 'C']);

function groupPrefix(pageNumbers) {
  const n = pageNumbers.length;
  return `You are given ${n} consecutive page images from the same book, in reading order:\
 pages ${pageNumbers.join(', ')}.

Transcribe EVERY page. Wrap each page's transcription in a tag carrying its page number:
${pageNumbers.map(p => `<page n="${p}">...transcription of page ${p}...</page>`).join('\n')}

Use the earlier pages only as context for reading the later ones — a word broken across
a page break, a running header you have already seen, a table continuing from the
previous leaf, a marginal note carried over. Never copy text from one page into
another's transcription. Apply all instructions below to each page independently.

`;
}

/**
 * Pull the TARGET page out of a grouped response.
 *
 * Mirrors the production translation batcher's parse (translate-worker.mjs:386):
 * match labelled tags, then fall back to POSITION when the model renumbered but
 * emitted the right count. Unlike production, which just needs a usable result,
 * this records HOW the page was recovered — `byLabel`, `byPosition`, or not at
 * all — because "the model renumbers pages" is itself a finding about whether
 * grouping is deployable, not an inconvenience to paper over.
 *
 * Returns segment=null on failure; the caller scores it on nothing rather than
 * counting a formatting fault as a reading fault.
 */
function extractTargetSegment(text, pageNumbers) {
  const target = pageNumbers[pageNumbers.length - 1];
  const found = new Map();
  const order = [];
  PAGE_TAG_RE.lastIndex = 0;
  let m;
  while ((m = PAGE_TAG_RE.exec(text)) !== null) {
    found.set(parseInt(m[1], 10), m[2].trim());
    order.push(m[2].trim());
  }
  if (found.has(target)) {
    return { segment: found.get(target), segments: found.size, recovery: 'byLabel' };
  }
  // Renumbering fallback — only when the count is exactly right, so position is
  // unambiguous. Anything else is a genuine failure.
  if (order.length === pageNumbers.length) {
    return { segment: order[order.length - 1], segments: order.length, recovery: 'byPosition' };
  }
  return { segment: null, segments: order.length, recovery: null };
}
const ARMS = {
  A: { label: 'transcribe-only', prompt: 'A-transcribe-only.txt' },
  // P reads the LIVE prompt from Mongo — the same row the pipeline reads. Use
  // it as the production baseline. B is the old file-pinned "current" arm and
  // is NOT current: it is a v10-era reconstruction missing the entire Output
  // contract block, which made it emit 47,813 looping characters on a blank
  // page where the live prompt emits none. Kept so earlier runs reproduce.
  P: { label: 'production (live, from DB)', fromDb: true },
  B: { label: 'v10-legacy (NOT production)', prompt: 'B-v10-legacy.txt', legacy: true },
  C: { label: 'required-conditions', prompt: 'C-required-conditions.txt', legacy: true },
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
  const groupN = parseInt(args.group || '1');

  const prompts = {};
  let productionPromptMeta = null;
  for (const k of armKeys) {
    if (!ARMS[k]) { console.error(`Unknown arm ${k}`); process.exit(1); }
    if (ARMS[k].fromDb) {
      const { db } = await connect();
      const p = await getProductionOcrPrompt(db);
      prompts[k] = p.text;
      productionPromptMeta = { version: p.version, name: p.name, content_hash: p.content_hash };
      console.log(`  arm ${k}: live prompt "${p.name}" v${p.version} (${p.text.length} chars)`);
    } else {
      prompts[k] = fs.readFileSync(path.join(PROMPT_DIR, ARMS[k].prompt), 'utf8');
      if (ARMS[k].second) prompts[`${k}2`] = fs.readFileSync(path.join(PROMPT_DIR, ARMS[k].second), 'utf8');
    }
    // Say it every run. A stale baseline is invisible in the output otherwise,
    // which is precisely how B-current.txt went unnoticed.
    if (ARMS[k].legacy) {
      console.warn(`  WARNING arm ${k} (${ARMS[k].prompt}) is a v10-era file, NOT the live prompt. Use arm P for a production baseline.`);
    }
  }

  // Calls per page: one per arm, plus a second for two-call arms, plus a grouped
  // replicate for each factorial arm when --group is set.
  const callsPerPageRun = armKeys.reduce((n, k) =>
    n + (ARMS[k].second ? 2 : 1) + (groupN > 1 && FACTORIAL_ARMS.has(k) ? 1 : 0), 0);
  const totalCalls = entries.length * models.length * runs * callsPerPageRun;

  // Estimate from MEASURED medians rather than the library's generic 1500/2000
  // guess: gemini_usage single-page OCR runs 3,272 input / 444 output (median,
  // n=1500). Input is 7.4x output and the page image dominates it, which is
  // exactly why arm D is expensive.
  const IN_TOK = 3272, OUT_TOK = 444, OUT_TOK_CLASSIFY = 40;

  console.log(`\nPrompt ablation — ${entries.length} pinned passages × ${models.length} model(s) × arms [${armKeys.join(',')}] × ${runs} run(s)`);
  console.log(`  ${totalCalls} model calls total\n`);
  let grandTotal = 0;
  for (const model of models) {
    const p = priceFor(model);
    let usd = 0;
    for (const k of armKeys) {
      usd += entries.length * runs * (IN_TOK / 1e6 * p.input + OUT_TOK / 1e6 * p.output);
      if (ARMS[k].second) usd += entries.length * runs * (IN_TOK / 1e6 * p.input + OUT_TOK_CLASSIFY / 1e6 * p.output);
      // A grouped call carries groupN images and transcribes groupN pages, so both
      // sides scale. The prompt text is sent once either way; the image dominates.
      if (groupN > 1 && FACTORIAL_ARMS.has(k)) {
        const IMG_TOK = 1870; // measured: 3,272 total in − ~1,400 prompt tokens
        usd += entries.length * runs * (
          (IN_TOK + (groupN - 1) * IMG_TOK) / 1e6 * p.input + (OUT_TOK * groupN) / 1e6 * p.output);
      }
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

    // Fetch the target's real predecessors for the grouped arm. A page without
    // enough predecessors is EXCLUDED from grouped arms rather than padded — a
    // short group is a different treatment, and quietly mixing the two would
    // confound the factor being tested.
    let contextBuffers = [];
    let groupPageNumbers = [];
    if (groupN > 1) {
      for (let d = groupN - 1; d >= 1; d--) {
        const prev = await getPage(gt.book_id, gt.page_number - d);
        const prevUrl = prev && getPageSource(prev);
        if (!prevUrl) { contextBuffers = null; break; }
        // Production refuses to batch when a page's text is very short — short
        // pages make the model skip the per-page tags and emit garbage
        // (translate-worker.mjs MIN_OCR_CHARS_FOR_BATCH). Honour the same guard
        // so a known-bad configuration isn't scored as if grouping had failed.
        if ((prev.ocr?.data || '').length > 0 && (prev.ocr.data.length < 200)) {
          contextBuffers = null;
          console.log(`  ~ ${gt.work}: predecessor p${prev.page_number} too short to batch, grouped arms skipped`);
          break;
        }
        try { contextBuffers.push(await fetchImage(prevUrl)); groupPageNumbers.push(prev.page_number); }
        catch { contextBuffers = null; break; }
      }
      if (contextBuffers) groupPageNumbers.push(gt.page_number);
      else if (groupPageNumbers.length !== 0 || contextBuffers === null) {
        if (contextBuffers === null && groupPageNumbers.length === 0) {
          console.log(`  ~ ${gt.work}: fewer than ${groupN - 1} predecessors, grouped arms skipped`);
        }
        groupPageNumbers = [];
      }
    }

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
       // Grouping is crossed with the prompt factor only for the arms in the
       // factorial (B, C). A and D are reference arms and stay ungrouped, so the
       // ceiling and the two-call control mean the same thing in every cell.
       const levels = (groupN > 1 && FACTORIAL_ARMS.has(k) && contextBuffers) ? [1, groupN] : [1];
       for (const g of levels) {
        for (let i = 0; i < runs; i++) {
          if (args.delay) await new Promise(r => setTimeout(r, parseInt(args.delay)));
          try {
            const grouped = g > 1;
            const images = grouped ? [...contextBuffers, imageBuffer] : imageBuffer;
            const promptText = grouped ? groupPrefix(groupPageNumbers) + prompts[k] : prompts[k];
            const res = await runModel(model, images, promptText, { maxTokens: grouped ? 32000 : 16000 });

            // Score only the TARGET page. A grouped response whose target cannot
            // be recovered is scored on nothing — treating it as low accuracy
            // would blame the reader for a formatting failure, and the two need
            // to stay distinguishable.
            let scoredText = res.text, segments = null, segmentationOk = true, recovery = null;
            if (grouped) {
              const seg = extractTargetSegment(res.text, groupPageNumbers);
              segments = seg.segments;
              recovery = seg.recovery;
              segmentationOk = seg.segment !== null;
              scoredText = seg.segment ?? res.text;
            }

            let signals = parseSignals(scoredText);
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

            const score = scoreAgainstReference(gt.ocr_ground_truth, stripTagsForScoring(scoredText), gt.script || 'cjk');
            const row = {
              work: gt.work, slug: gt._file.replace(/\.json$/, ''), script: gt.script,
              canonical: gt.page_class?.canonical_text ?? null,
              model, arm: k, armLabel: ARMS[k].label, armSuffix, run: i + 1,
              group: g, segments, segmentationOk, recovery,
              finishReason: res.finishReason,
              aligned: score.aligned,
              charAccuracy: score.aligned ? score.charAccuracy : null,
              cer: score.aligned ? score.cer : null,
              refChars: score.refLen,
              // Grouped calls transcribe g pages for one scored observation, so
              // report both: the call's cost, and its cost amortized per page —
              // the number that matters if grouping were deployed.
              costUsd: cost,
              costPerPageUsd: cost / g,
              ...signals,
            };
            rows.push(row);
            fs.appendFileSync(outFile, JSON.stringify({ ...row, text: res.text, secondText }) + '\n');

            const acc = row.charAccuracy === null ? '  n/a' : (row.charAccuracy * 100).toFixed(1) + '%';
            const cond = signals.conditionsPresent
              ? (signals.conditions.length ? signals.conditions.join('|').slice(0, 26) : 'none')
              : '\x1b[31mMISSING\x1b[0m';
            const segFlag = grouped && !segmentationOk ? ` \x1b[33mSEG:${segments}/${g}\x1b[0m` : '';
            console.log(`  ${gt.work.slice(0, 22).padEnd(22)} ${model.slice(0, 20).padEnd(20)} ${k}g${g} acc=${acc.padStart(6)}  cond=${cond}${segFlag}`);
          } catch (e) {
            console.log(`  ! ${gt.work} × ${model} × ${k}g${g} run ${i + 1}: ${String(e.message).slice(0, 100)}`);
          }
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
    // Which prompt the production arm actually ran. Without this a result file
    // cannot be tied to a prompt, and "current production" becomes unfalsifiable
    // — which is how B-current.txt stayed stale through an entire study series.
    production_prompt: productionPromptMeta,
    rows,
  }, null, 2));

  console.log(`\n  Raw outputs → ${path.relative(process.cwd(), outFile)}`);
  console.log(`  Summary     → ${path.relative(process.cwd(), summaryFile)}`);
  console.log(`  Analyse     → node scripts/eval/report-ablation.mjs ${path.relative(process.cwd(), summaryFile)}\n`);
  await disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
