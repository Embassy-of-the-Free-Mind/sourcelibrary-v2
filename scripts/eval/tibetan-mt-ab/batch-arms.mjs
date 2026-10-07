#!/usr/bin/env node
// PRIOR ART: ./gemini-arms.mjs — the same Gemini arms over the same pinned 84000-matched sample, but
// one REALTIME call per page from a pinned copy of the Yigdzin read. It cannot answer "what will the
// Batch retranslation cost and produce": the lane that would run the 189K-page job is the Batch API
// (file-based jobs, as scripts/workers/translate-batch-worker.mjs submits them), and its input is
// `pages.ocr.data` as it is NOW (leaf-break markers from #5264 included), with the adjacent OCR the
// single-page prompt carries in production. This script submits ONE Batch job per model over the
// sample, polls it, and writes the arm outputs in gemini-arms.mjs's shape, so build-judge-packet.mjs
// and score.mjs read them unchanged. Cost is computed from usageMetadata at the Batch rate.
//
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/tibetan-mt-ab/batch-arms.mjs \
//        --ids <ids-final.txt> --out <dir> [--arms gemini-3.1-flash-lite,gemini-3-flash-preview] [--poll-minutes 45] [--dry-run]
//
// Writes <out>/gemini/<model>-batch/<id>.json  { id, arm, text, finishReason, inputTokens, outputTokens,
// ms (job wall time), cost_usd (BATCH rate), prompt_ref, src_chars, job } and <out>/jobs.json.
// Run on Hetzner (the laptop is geo-blocked for Gemini). Resumable: a model whose outputs all exist is skipped.
//
// Opt-in flags added for #5606 (defaults unchanged, so the 2026-10-01 Tibetan run reproduces):
//   --arms model@label     run one model under a label (dir <label>-batch), e.g. a second independent
//                          lite job as the A-vs-A noise floor: gemini-3.1-flash-lite@lite-rerun
//   --production-config    send the production chained lane's generationConfig exactly
//                          (scripts/lib/translate-batch-chained.mjs: no temperature → API default,
//                          thinkingBudget 0) instead of temperature 0
//   --meter <endpoint>     write a gemini_usage placeholder at submit and complete it from the
//                          responses (supabase-usage-logger.mjs, the lane's own meter), so the spend
//                          is on the ledger and under the daily dial, not hand-copied
//   --cap-usd X            refuse to submit if the Batch-rate estimate over all arms exceeds X

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';
import { PAGE_BREAK_SCOPED, buildTranslationPrompt, loadTranslationPrompts, sanitizeTranslationTags } from '../../lib/translate-core.mjs';
import { costOf } from '../../lib/model-pricing.mjs';
import { logUsage, completeBatchUsage, sumBatchResponseUsage } from '../../workers/lib/supabase-usage-logger.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const flag = (n) => args.includes(`--${n}`);
const IDS = opt('ids'); const OUT = opt('out');
const ARMS = opt('arms', 'gemini-3.1-flash-lite,gemini-3-flash-preview').split(',').map((a) => { const [model, label] = a.split('@'); return { model, label: label || model }; });
const POLL_MIN = Number(opt('poll-minutes', 45));
const DRY = flag('dry-run');
const PRODUCTION_CONFIG = flag('production-config');
const METER = opt('meter', null);
const CAP_USD = opt('cap-usd', null) == null ? null : Number(opt('cap-usd'));
if (!IDS || !OUT) { console.error('--ids and --out are required'); process.exit(1); }
const BATCH_MULTIPLIER = 0.5;
const SAFETY = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT', 'HARM_CATEGORY_CIVIC_INTEGRITY']
  .map((category) => ({ category, threshold: 'BLOCK_NONE' }));
const KEYS = [...new Set([process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2, process.env.GEMINI_API_KEY_3].filter(Boolean))];
if (!KEYS.length && !DRY) { console.error('no GEMINI_API_KEY'); process.exit(1); }
const maxOutputTokensFor = (ocrChars) => Math.min(32768, Math.max(4096, ocrChars + 1200));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sample = fs.readFileSync(IDS, 'utf8').trim().split('\n').map((l) => l.trim().split(/\s+/))
  .map(([book, page]) => ({ book, page: Number(page), id: `${book}_${String(page).padStart(5, '0')}` }));

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const prompts = await loadTranslationPrompts(db);

// 1. Build the production single-page prompt for every page, from the CURRENT OCR.
const units = [];
for (const r of sample) {
  const book = await db.collection('books').findOne({ id: r.book });
  const rows = await db.collection('pages').find({ book_id: r.book, page_number: { $in: [r.page - 1, r.page, r.page + 1] } }, { projection: { page_number: 1, 'ocr.data': 1 } }).toArray();
  const by = Object.fromEntries(rows.map((p) => [p.page_number, p.ocr?.data || '']));
  const ocrText = by[r.page];
  if (!ocrText) { console.log(`${r.id}: no OCR, skipped`); continue; }
  const { prompt, promptRef } = buildTranslationPrompt({ prompts, book, ocrText, previousTranslation: null, prevOcrText: by[r.page - 1] || undefined, nextOcrText: by[r.page + 1] || undefined, pageBreak: PAGE_BREAK_SCOPED });
  units.push({ ...r, prompt, promptRef, src_chars: ocrText.length, maxOutputTokens: maxOutputTokensFor(ocrText.length) });
}
await client.close();
console.log(`${units.length} pages, prompt v${units[0]?.promptRef?.version}, ${units.reduce((n, u) => n + u.prompt.length, 0)} prompt chars`);

const jobs = fs.existsSync(path.join(OUT, 'jobs.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'jobs.json'), 'utf8')) : {};
const estimateOf = (model) => units.reduce((s, u) => s + costOf(model, u.prompt.length / 3, u.src_chars / 3 + 300) * BATCH_MULTIPLIER, 0);
if (CAP_USD != null) {
  const total = ARMS.reduce((s, a) => s + estimateOf(a.model), 0);
  console.log(`estimate over ${ARMS.length} arms: $${total.toFixed(4)} at the Batch rate (cap $${CAP_USD})`);
  if (total > CAP_USD) { console.error(`REFUSED: estimate $${total.toFixed(4)} exceeds --cap-usd ${CAP_USD}`); process.exit(2); }
}
const generationConfigFor = (u) => (PRODUCTION_CONFIG
  ? { maxOutputTokens: u.maxOutputTokens, thinkingConfig: { thinkingBudget: 0 } }
  : { temperature: 0, maxOutputTokens: u.maxOutputTokens, thinkingConfig: { thinkingBudget: 0 } });
for (const { model, label } of ARMS) {
  const dir = path.join(OUT, 'gemini', `${label}-batch`);
  fs.mkdirSync(dir, { recursive: true });
  if (units.every((u) => fs.existsSync(path.join(dir, `${u.id}.json`)))) { console.log(`${label}: all outputs present, skipped`); continue; }
  if (DRY) {
    console.log(`[dry] ${label} (${model}): ${units.length} requests ≈ $${estimateOf(model).toFixed(4)} at the Batch rate`);
    continue;
  }
  // 2. One file-based Batch job per model, as the worker submits them.
  const lines = units.map((u) => JSON.stringify({ key: u.id, request: {
    contents: [{ role: 'user', parts: [{ text: u.prompt }] }],
    generationConfig: generationConfigFor(u),
    safetySettings: SAFETY,
  } }));
  const tmp = path.join(os.tmpdir(), `tmab-${label}-${Date.now().toString(36)}.jsonl`);
  fs.writeFileSync(tmp, lines.join('\n') + '\n');
  let job = jobs[label];
  let ai, keyIndex = 0;
  if (!job) {
    for (keyIndex = 0; keyIndex < KEYS.length; keyIndex++) {
      ai = new GoogleGenAI({ apiKey: KEYS[keyIndex] });
      try {
        const file = await ai.files.upload({ file: tmp, config: { mimeType: 'text/plain', displayName: `tmab-${model}` } });
        for (let i = 0; i < 30; i++) { const st = (await ai.files.get({ name: file.name }))?.state; if (st === 'ACTIVE') break; if (st === 'FAILED') throw new Error('file FAILED'); await sleep(2000); }
        // usage-ok: eval harness — each Batch job is priced from its own usage into the arm outputs; with --meter it is also on the gemini_usage ledger (placeholder here, completed from the responses below); not a production call site
        const created = await ai.batches.create({ model, src: { fileName: file.name }, config: { displayName: `${METER || 'tibetan-mt-ab'} batch ${label}` } });
        try { await ai.files.delete({ name: file.name }); } catch { /* reaped by batch-collector's sweeper */ }
        job = { name: created.name, model, keyIndex, submitted_at: new Date().toISOString(), requests: units.length, generation_config: PRODUCTION_CONFIG ? 'production (no temperature, thinkingBudget 0)' : 'temperature 0, thinkingBudget 0' };
        jobs[label] = job;
        if (METER) await logUsage({ type: 'translation', mode: 'batch', model, page_count: units.length, input_tokens: 0, output_tokens: 0, status: 'submitted', batch_job_id: created.name, endpoint: METER, prompt_version: String(units[0]?.promptRef?.version ?? ''), triggered_by: 'manual' });
        fs.writeFileSync(path.join(OUT, 'jobs.json'), JSON.stringify(jobs, null, 1));
        console.log(`${label}: submitted ${created.name} with key ${keyIndex}`);
        break;
      } catch (err) {
        console.log(`${label}: key ${keyIndex} refused (${String(err.message).slice(0, 100)})`);
        if (keyIndex === KEYS.length - 1) throw err;
      }
    }
  } else { keyIndex = job.keyIndex; ai = new GoogleGenAI({ apiKey: KEYS[keyIndex] }); console.log(`${label}: resuming ${job.name}`); }
  fs.unlinkSync(tmp);
  // 3. Poll.
  const t0 = Date.now();
  let state = '', got;
  while (Date.now() - t0 < POLL_MIN * 60000) {
    got = await ai.batches.get({ name: job.name });
    state = got.state;
    if (/SUCCEEDED|FAILED|CANCELLED|EXPIRED/.test(state)) break;
    process.stdout.write(`  ${label} ${state} ${Math.round((Date.now() - t0) / 1000)}s\r`);
    await sleep(20000);
  }
  console.log(`\n${label}: ${state} after ${Math.round((Date.now() - t0) / 1000)}s`, got?.batchStats ? JSON.stringify(got.batchStats) : '');
  if (state !== 'JOB_STATE_SUCCEEDED') { console.log(`${label}: not collected (${state}); re-run to resume`); continue; }
  let responses = got.dest?.inlinedResponses || [];
  if (got.dest?.fileName) {
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/${got.dest.fileName}:download?alt=media&key=${KEYS[keyIndex]}`);
    if (!resp.ok) throw new Error(`result download failed (${resp.status})`);
    responses = (await resp.text()).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }
  if (METER && !job.metered) {
    const { inputTokens, outputTokens } = sumBatchResponseUsage(responses);
    const r = await completeBatchUsage({ type: 'translation', mode: 'batch', model, page_count: units.length, input_tokens: inputTokens, output_tokens: outputTokens, status: 'success', batch_job_id: job.name, endpoint: METER, triggered_by: 'manual' });
    job.metered = r; job.usage = { inputTokens, outputTokens };
    fs.writeFileSync(path.join(OUT, 'jobs.json'), JSON.stringify(jobs, null, 1));
    console.log(`${label}: meter ${r} (${inputTokens} in / ${outputTokens} out)`);
  }
  const ms = Date.now() - new Date(job.submitted_at).getTime();
  let spent = 0, n = 0;
  for (const u of units) {
    const r = responses.find((x) => x.key === u.id || x.metadata?.key === u.id);
    const resp = r?.response;
    if (!resp) { fs.writeFileSync(path.join(dir, `${u.id}.failed.json`), JSON.stringify({ id: u.id, arm: label, model, error: r?.error || 'no response' }, null, 1)); continue; }
    const text = sanitizeTranslationTags(resp.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '');
    const um = resp.usageMetadata || {};
    const cost_usd = costOf(model, um.promptTokenCount || 0, (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0)) * BATCH_MULTIPLIER;
    spent += cost_usd; n++;
    fs.writeFileSync(path.join(dir, `${u.id}.json`), JSON.stringify({ id: u.id, arm: label, model, text, finishReason: resp.candidates?.[0]?.finishReason, inputTokens: um.promptTokenCount, outputTokens: um.candidatesTokenCount, thinkingTokens: um.thoughtsTokenCount || 0, ms, cost_usd, cost_basis: 'usageMetadata × batch rate', prompt_ref: u.promptRef, src_chars: u.src_chars, job: job.name }, null, 1));
  }
  console.log(`${label}: ${n}/${units.length} written, $${spent.toFixed(4)} at the Batch rate (${(spent / Math.max(1, n)).toFixed(5)}/page)`);
}
