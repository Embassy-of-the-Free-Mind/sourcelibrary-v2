#!/usr/bin/env node
/**
 * Study 2: Ground Truth Evaluation
 *
 * For each of the 100 selected pages, sends the page image to Claude Opus
 * to produce:
 *   1. Ground truth OCR transcription
 *   2. Evaluation of the existing Gemini OCR output (quality, errors, hallucination)
 *   3. Causal analysis of hallucination triggers
 *
 * Usage:
 *   node scripts/eval/study2-ground-truth.mjs                    # process all unfinished pages
 *   node scripts/eval/study2-ground-truth.mjs --lang=Hebrew      # process only Hebrew pages
 *   node scripts/eval/study2-ground-truth.mjs --page=5           # process page index 5 only
 *   node scripts/eval/study2-ground-truth.mjs --dry-run          # show what would be processed
 *   node scripts/eval/study2-ground-truth.mjs stats              # show progress statistics
 */

import { createClient } from '@supabase/supabase-js';
import { runClaude, fetchImage } from './lib/runners.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load env
for (const file of ['.env.production.local', '.env.local']) {
  try {
    const content = fs.readFileSync(file, 'utf8');
    for (const line of content.split('\n')) {
      const m = line.match(/^([^=#]+)=(.*)$/);
      if (m) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (!process.env[m[1].trim()]) process.env[m[1].trim()] = v;
      }
    }
  } catch {}
}

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

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

const RESULTS_DIR = path.join(__dirname, 'ground-truth', 'results');
const SELECTION_PATH = path.join(__dirname, 'ground-truth', 'study2-page-selection.json');
const MODEL = 'claude-opus-4-6';

// ── Prompts ──────────────────────────────────────────────────────────

const TRANSCRIPTION_PROMPT = `You are an expert paleographer and philologist evaluating OCR quality on historical manuscripts.

Look at this page image carefully. Produce a ground truth transcription of the visible text.

Instructions:
- Transcribe ALL text visible on the page, including headers, marginalia, and annotations
- Use the original script (Hebrew, Greek, Arabic, etc.) — do not transliterate
- Mark illegible portions with [illegible]
- Mark uncertain readings with [?] after the uncertain word
- Note any non-text elements (illustrations, diagrams, decorations) with [illustration: brief description]
- If the page has multiple text blocks or columns, indicate structure with --- separators
- Be honest about what you can and cannot read. Do NOT generate text you cannot see.

Respond with ONLY the transcription. No commentary.`;

function makeEvalPrompt(existingOcr, category, language) {
  const ocrSnippet = existingOcr.length > 4000
    ? existingOcr.slice(0, 2000) + '\n\n[... ' + (existingOcr.length - 4000) + ' chars omitted ...]\n\n' + existingOcr.slice(-2000)
    : existingOcr;

  return `You are an expert evaluator of OCR quality on historical ${language} manuscripts.

I will show you a page image and the OCR output that a VLM (Gemini) produced for it. Evaluate the OCR quality.

## OCR Output to Evaluate
\`\`\`
${ocrSnippet}
\`\`\`

## Instructions

Respond with a JSON object (no markdown fencing) containing:

{
  "quality": "good|acceptable|poor|hallucinated",
  "hallucination": true/false,
  "hallucination_type": null | "repetitive_loop" | "generative_fabrication" | "uncertainty_repetition" | "mixed",
  "hallucination_trigger": null | "description of what visual feature triggered hallucination",
  "cer_estimate": 0.0-1.0,
  "errors": ["list of specific errors found"],
  "ocr_length_vs_actual": "shorter|appropriate|longer|much_longer",
  "actual_text_estimate_chars": approximate number of characters actually on the page,
  "structural_accuracy": "good|partial|poor",
  "notes": "any additional observations about OCR quality, page difficulty, or interesting patterns"
}

Definitions:
- quality "good": CER < 5%, no hallucination
- quality "acceptable": CER 5-15%, minor issues
- quality "poor": CER > 15%, significant errors but text is real
- quality "hallucinated": model generated text not on the page
- cer_estimate: approximate character error rate (0=perfect, 1=completely wrong)
- hallucination_type:
  - "repetitive_loop": model repeats same text/tags many times
  - "generative_fabrication": model generates fluent but fake text in the source language
  - "uncertainty_repetition": model repeats [?] or similar markers
  - "mixed": combination of patterns
- ocr_length_vs_actual: compare OCR output length to what's actually on the page

Be rigorous. Compare the OCR output against what you can actually see in the image.`;
}

// ── Page processing ──────────────────────────────────────────────────

async function processPage(pageSpec, index) {
  const { book_id, page_number, language, category, hallucination_ratio, ocr_model } = pageSpec;
  const resultFile = path.join(RESULTS_DIR, `${book_id}_p${page_number}.json`);

  // Skip if already processed
  if (fs.existsSync(resultFile)) {
    const existing = JSON.parse(fs.readFileSync(resultFile));
    if (existing.evaluation && existing.opus_ocr) {
      console.log(`  [${index}] SKIP ${language} ${book_id} p${page_number} (already done)`);
      return { skipped: true };
    }
  }

  console.log(`  [${index}] Processing ${language} ${category} ${book_id} p${page_number} (${ocr_model}, ratio=${hallucination_ratio || '-'})`);

  // Fetch page data from Supabase
  const { data: page, error } = await sb.from('pages')
    .select('photo,archived_photo,ocr_data,ocr_model,page_type,script_type,columns')
    .eq('book_id', book_id)
    .eq('page_number', page_number)
    .single();

  if (error || !page) {
    console.error(`    ERROR: Page not found: ${error?.message || 'no data'}`);
    return { error: 'page_not_found' };
  }

  // Fetch book metadata
  const { data: book } = await sb.from('books_catalog')
    .select('title,language,resource_type,provider_name')
    .eq('id', book_id)
    .single();

  // Get image
  const imageUrl = page.archived_photo || page.photo;
  if (!imageUrl) {
    console.error(`    ERROR: No image URL for page`);
    return { error: 'no_image_url' };
  }

  let imageBuffer;
  try {
    imageBuffer = await fetchImage(imageUrl, 60000);
    console.log(`    Image: ${(imageBuffer.length / 1024).toFixed(0)}KB`);
  } catch (e) {
    console.error(`    ERROR fetching image: ${e.message}`);
    return { error: 'image_fetch_failed', detail: e.message };
  }

  // Step 1: Opus ground truth transcription
  console.log(`    Transcribing with Opus...`);
  let opusResult;
  try {
    opusResult = await runClaude(MODEL, imageBuffer, TRANSCRIPTION_PROMPT, { maxTokens: 16000, temperature: 0 });
    console.log(`    Transcription: ${opusResult.text.length} chars, $${opusResult.costUsd.toFixed(4)}`);
  } catch (e) {
    console.error(`    ERROR in Opus transcription: ${e.message}`);
    return { error: 'opus_transcription_failed', detail: e.message };
  }

  // Step 2: Evaluate existing OCR
  console.log(`    Evaluating existing OCR (${(page.ocr_data?.length || 0)} chars)...`);
  let evalResult;
  try {
    const evalPrompt = makeEvalPrompt(page.ocr_data || '', category, language);
    evalResult = await runClaude(MODEL, imageBuffer, evalPrompt, { maxTokens: 4000, temperature: 0 });
    console.log(`    Evaluation: $${evalResult.costUsd.toFixed(4)}`);
  } catch (e) {
    console.error(`    ERROR in Opus evaluation: ${e.message}`);
    return { error: 'opus_evaluation_failed', detail: e.message };
  }

  // Parse evaluation JSON
  let evaluation;
  try {
    // Strip markdown fencing if present
    let evalText = evalResult.text.trim();
    if (evalText.startsWith('```')) evalText = evalText.replace(/^```\w*\n?/, '').replace(/\n?```$/, '').trim();
    evaluation = JSON.parse(evalText);
  } catch (e) {
    console.warn(`    WARN: Could not parse eval JSON, storing raw text`);
    evaluation = { raw: evalResult.text, parse_error: e.message };
  }

  // Build result
  const result = {
    book_id,
    page_number,
    language,
    category,
    hallucination_ratio: hallucination_ratio || null,
    book_title: book?.title || null,
    resource_type: book?.resource_type || null,
    provider: book?.provider_name || null,
    image_url: imageUrl,
    page_type: page.page_type,
    script_type: page.script_type,
    columns: page.columns,
    // Existing OCR
    existing_ocr_model: page.ocr_model,
    existing_ocr_chars: page.ocr_data?.length || 0,
    // Opus ground truth
    opus_ocr: opusResult.text,
    opus_ocr_chars: opusResult.text.length,
    opus_cost_usd: opusResult.costUsd,
    opus_input_tokens: opusResult.inputTokens,
    opus_output_tokens: opusResult.outputTokens,
    opus_duration_ms: opusResult.durationMs,
    // Evaluation
    evaluation,
    eval_cost_usd: evalResult.costUsd,
    // Timestamps
    processed_at: new Date().toISOString(),
  };

  // Save
  fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
  console.log(`    Saved: ${resultFile}`);

  const totalCost = opusResult.costUsd + evalResult.costUsd;
  return { success: true, costUsd: totalCost, quality: evaluation.quality };
}

// ── Stats ────────────────────────────────────────────────────────────

function showStats() {
  const selection = JSON.parse(fs.readFileSync(SELECTION_PATH));
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const done = fs.readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json'));

  console.log(`\n=== Study 2: Ground Truth Progress ===\n`);
  console.log(`Total pages: ${selection.pages.length}`);
  console.log(`Completed: ${done.length}`);
  console.log(`Remaining: ${selection.pages.length - done.length}`);

  if (done.length === 0) return;

  // Load completed results
  const results = done.map(f => JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f))));
  const totalCost = results.reduce((sum, r) => sum + (r.opus_cost_usd || 0) + (r.eval_cost_usd || 0), 0);

  console.log(`\nTotal cost so far: $${totalCost.toFixed(2)}`);
  console.log(`Avg cost per page: $${(totalCost / done.length).toFixed(4)}`);

  // Quality distribution
  const qualities = {};
  for (const r of results) {
    const q = r.evaluation?.quality || 'unknown';
    qualities[q] = (qualities[q] || 0) + 1;
  }
  console.log('\nQuality distribution:');
  for (const [q, n] of Object.entries(qualities).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${q.padEnd(15)} ${n}`);
  }

  // By language
  const byLang = {};
  for (const r of results) {
    if (!byLang[r.language]) byLang[r.language] = { total: 0, hallucinated: 0 };
    byLang[r.language].total++;
    if (r.evaluation?.hallucination) byLang[r.language].hallucinated++;
  }
  console.log('\nBy language:');
  for (const [lang, s] of Object.entries(byLang).sort((a, b) => b[1].total - a[1].total)) {
    console.log(`  ${lang.padEnd(20)} ${s.total} done, ${s.hallucinated} hallucinated`);
  }

  // Hallucination types
  const types = {};
  for (const r of results) {
    if (r.evaluation?.hallucination_type) types[r.evaluation.hallucination_type] = (types[r.evaluation.hallucination_type] || 0) + 1;
  }
  if (Object.keys(types).length > 0) {
    console.log('\nHallucination types:');
    for (const [t, n] of Object.entries(types).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${t.padEnd(25)} ${n}`);
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  if (command === 'stats') { showStats(); return; }

  const selection = JSON.parse(fs.readFileSync(SELECTION_PATH));
  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  // Filter pages
  let pages = selection.pages;
  if (args.lang) pages = pages.filter(p => p.language === args.lang);
  if (args.page !== undefined) pages = [pages[parseInt(args.page)]];
  if (args.category) pages = pages.filter(p => p.category === args.category);

  console.log(`\n=== Study 2: Ground Truth Evaluation ===`);
  console.log(`Pages to process: ${pages.length}`);
  console.log(`Model: ${MODEL}`);

  if (args['dry-run']) {
    for (const [i, p] of pages.entries()) {
      const done = fs.existsSync(path.join(RESULTS_DIR, `${p.book_id}_p${p.page_number}.json`));
      console.log(`  [${i}] ${done ? 'DONE' : 'TODO'} ${p.language.padEnd(12)} ${p.category.padEnd(14)} ratio=${(p.hallucination_ratio || '-').toString().padStart(5)} ${p.book_id} p${p.page_number}`);
    }
    const todo = pages.filter(p => !fs.existsSync(path.join(RESULTS_DIR, `${p.book_id}_p${p.page_number}.json`)));
    console.log(`\nTODO: ${todo.length} pages`);
    // Rough cost estimate: ~$0.15 per page (transcription + eval)
    console.log(`Estimated cost: ~$${(todo.length * 0.15).toFixed(2)}`);
    return;
  }

  let totalCost = 0;
  let processed = 0;
  let errors = 0;

  for (const [i, p] of pages.entries()) {
    try {
      const result = await processPage(p, i);
      if (result.skipped) continue;
      if (result.error) { errors++; continue; }
      if (result.success) {
        totalCost += result.costUsd;
        processed++;
        console.log(`    Quality: ${result.quality} | Running cost: $${totalCost.toFixed(2)}`);
      }
    } catch (e) {
      console.error(`  [${i}] FATAL: ${e.message}`);
      errors++;
    }

    // Rate limit: 1 request per 2 seconds (Opus is expensive, be gentle)
    if (i < pages.length - 1) await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`\n=== DONE ===`);
  console.log(`Processed: ${processed}`);
  console.log(`Errors: ${errors}`);
  console.log(`Total cost: $${totalCost.toFixed(2)}`);
}

main().catch(err => { console.error(err); process.exit(1); });
