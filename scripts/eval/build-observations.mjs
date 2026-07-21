#!/usr/bin/env node
/**
 * Build the append-only OCR-eval OBSERVATIONS dataset (#3212 follow-up).
 *
 * One JSONL row per (page × source × run): the stored pipeline OCR, every raw
 * model output dumped by `qa-eval scorecard --models=…` (results/scorecard-
 * outputs-*.jsonl), and any transcript directories (e.g. interactive Claude
 * transcriptions). Everything is RE-SCORED with the current normalization at
 * build time and stamped with `scoring_version`, so runs made under older
 * folds merge cleanly — raw text is the durable artifact, scores are derived.
 *
 * Output: scripts/eval/observations/ocr-observations-<date>.jsonl
 * Merge across days/runs by concatenating files; dedupe key is
 * (run_id, slug, model, run_index).
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/build-observations.mjs \
 *     [--transcripts=/path/dir:run_id:model_label] [--date=YYYY-MM-DD]
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { scoreAgainstReference, normalizeCJK, normalizeForScript } from './lib/metrics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const DATE = args.date || new Date().toISOString().slice(0, 10);
const scoringVersion = execSync('git log -1 --format=%h -- scripts/eval/lib/metrics.mjs', { cwd: __dirname }).toString().trim();

const gtDir = path.join(__dirname, 'ground-truth');
const gts = fs.readdirSync(gtDir).filter(f => f.endsWith('.json'))
  .map(f => ({ slug: f.replace('.json', ''), ...JSON.parse(fs.readFileSync(path.join(gtDir, f), 'utf8')) }))
  .filter(g => g.ocr_ground_truth);
const bySlug = Object.fromEntries(gts.map(g => [g.slug, g]));
const byWork = Object.fromEntries(gts.map(g => [g.work, g]));

const norm = (gt, t) => gt.script === 'cjk' ? normalizeCJK(t || '') : normalizeForScript(t || '', gt.script).replace(/ /g, '');

function observation(gt, source, runId, model, runIndex, text, extra = {}) {
  const r = scoreAgainstReference(gt.ocr_ground_truth, text || '', gt.script || 'cjk');
  // Recension divergence (#3235 outcome battery): score any alternate reference
  // recensions too. A model matching a canonical recension BETTER than the
  // edition actually printed on the page is a recitation fingerprint.
  let alt_scores;
  for (const alt of gt.alt_references || []) {
    const a = scoreAgainstReference(alt.reference, text || '', gt.script || 'cjk');
    (alt_scores ??= {})[alt.name] = {
      aligned: a.aligned, guard_value: +a.guard.value.toFixed(4),
      char_accuracy_raw: +a.charAccuracy.toFixed(4),
      char_accuracy_windowed: a.charAccuracyWindowed == null ? null : +a.charAccuracyWindowed.toFixed(4),
    };
  }
  return {
    run_id: runId, date: DATE, source, model, run_index: runIndex,
    slug: gt.slug, work: gt.work, book_id: gt.book_id, page_number: gt.page_number,
    script: gt.script, language: gt.language,
    reference_source: gt.source, reference_url: gt.source_url,
    ref_chars: r.refLen, aligned: r.aligned,
    guard_type: r.guard.type, guard_value: +r.guard.value.toFixed(4),
    cer: r.aligned ? +r.cer.toFixed(4) : null,
    char_accuracy: r.aligned ? +r.charAccuracy.toFixed(4) : null,
    // Raw (unconditional) accuracy: retained even when the guard fails, so
    // roll-ups can report expected accuracy without alignment-survivorship bias.
    // Interpret with care — on unaligned runs this may score a coincidental match.
    char_accuracy_raw: +r.charAccuracy.toFixed(4),
    // WINDOWED accuracy (PR #3304): the LOWER bound to char_accuracy's UPPER one.
    // Free-skip inflation scales with output verbosity (12.9pp for Tesseract vs
    // 5.7pp for Gemini on these pages), so it does NOT cancel when models or
    // engines are differenced. Quote the pair, never one alone.
    char_accuracy_windowed: r.charAccuracyWindowed == null ? null : +r.charAccuracyWindowed.toFixed(4),
    // Width of the bracket = how much non-reference material sits inside the
    // passage span. Small on clean single-column pages, large where apparatus
    // interleaves with the text.
    bracket_width: r.charAccuracyWindowed == null ? null : +(r.charAccuracy - r.charAccuracyWindowed).toFixed(4),
    span_dispersion: r.spanDispersion,
    output_norm_chars: norm(gt, text).length,
    ...(alt_scores ? { alt_scores } : {}),
    page_class: gt.page_class || null,
    audit_note: gt.audit_note ? true : false,
    scoring_version: scoringVersion,
    ...extra,
  };
}

const rows = [];

// 1. Stored pipeline OCR (one observation per page)
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const P = client.db(process.env.MONGODB_DB || 'bookstore').collection('pages');
for (const gt of gts) {
  const pg = await P.findOne({ book_id: gt.book_id, page_number: gt.page_number },
    { projection: { 'ocr.data': 1, 'ocr.model': 1, 'scan_quality': 1 } });
  rows.push(observation(gt, 'pipeline', `pipeline@${DATE}`, pg?.ocr?.model || 'unknown', 1, pg?.ocr?.data || '',
    { scan_quality: pg?.scan_quality || null }));
}
await client.close();

// 2. Raw model outputs from scorecard runs (rescored with current normalization)
const resultsDir = path.join(__dirname, 'results');
for (const f of fs.readdirSync(resultsDir).filter(f => f.startsWith('scorecard-outputs-') && f.endsWith('.jsonl'))) {
  const runId = f.replace('.jsonl', '');
  for (const line of fs.readFileSync(path.join(resultsDir, f), 'utf8').split('\n').filter(Boolean)) {
    const o = JSON.parse(line);
    const gt = byWork[o.work];
    if (!gt) continue; // work later dropped from ground truth (e.g. recitation rows)
    rows.push(observation(gt, 'api', runId, o.model, o.run, o.text, { finish_reason: o.finishReason }));
  }
}

// 3. Transcript directories: --transcripts=/dir:run_id:model_label (repeatable via comma)
for (const spec of (args.transcripts || '').split(',').filter(Boolean)) {
  const [dir, runId, label] = spec.split(':');
  for (const gt of gts) {
    const tf = path.join(dir, `${gt.slug}.txt`);
    if (!fs.existsSync(tf)) continue;
    rows.push(observation(gt, 'interactive', runId, label, 1, fs.readFileSync(tf, 'utf8')));
  }
}

// 4. Legacy consistency runs (results/*-consistency-*.json, 2026-04 → 06).
// Those runs sampled arbitrary pages with NO reference texts, so accuracy fields
// are null — they contribute stability metrics (MCR, pairwise similarity) plus
// the ONE raw text that survived: mcr.modalOutput (the majority-vote output).
// Per-run texts were discarded at the time and are unrecoverable — which is the
// cautionary tale behind this dataset's raw-text-first design.
for (const f of fs.readdirSync(resultsDir).filter(f => /-consistency-\d{4}-\d{2}-\d{2}\.json$/.test(f))) {
  let d;
  try { d = JSON.parse(fs.readFileSync(path.join(resultsDir, f), 'utf8')); } catch { continue; }
  const runDate = f.match(/(\d{4}-\d{2}-\d{2})/)[1];
  for (const p of d.pages || []) {
    for (const [combo, r] of Object.entries(p.results || {})) {
      if (!r?.mcr) continue;
      rows.push({
        run_id: f.replace('.json', ''), date: runDate, source: 'api',
        model: r.model || combo.split('@')[0], run_index: 'modal',
        temperature: r.temperature ?? null,
        slug: null, work: null, corpus: d.corpus || null,
        book_id: p.bookId, page_number: p.pageNumber,
        script: (p.script || '').toLowerCase() || null, language: null,
        reference_source: null, reference_url: null,
        ref_chars: null, aligned: null, guard_type: null, guard_value: null,
        cer: null, char_accuracy: null,
        mcr_rate: r.mcr.rate ?? null,
        mcr_runs: r.mcr.totalRuns ?? null,
        pairwise_char: r.pairwise?.avgCharSimilarity ?? null,
        pairwise_syllable: r.pairwise?.avgSyllableSimilarity ?? null,
        output_norm_chars: (r.mcr.modalOutput || '').length,
        modal_output: r.mcr.modalOutput || null,
        cost_usd: r.costUsd ?? null,
        page_class: null, audit_note: false, scoring_version: scoringVersion,
      });
    }
  }
}

const outDir = path.join(__dirname, 'observations');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `ocr-observations-${DATE}.jsonl`);
fs.writeFileSync(outFile, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
console.log(`Wrote ${rows.length} observations → ${outFile}`);
const runs = [...new Set(rows.map(r => `${r.run_id} × ${r.model}`))];
console.log(runs.map(r => '  ' + r).join('\n'));
