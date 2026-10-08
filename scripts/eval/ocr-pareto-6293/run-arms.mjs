#!/usr/bin/env node
// PRIOR ART: scripts/eval/pareto-6182/run-arms.mjs — one Batch job per model, the thinking setting each new Gemini
// model accepts, metered to gemini_usage and registered as external_eval; it sends text-only translation requests.
// scripts/eval/benchmark-run-api.mjs — the request the charted lite / 3 Flash points were read with (generic or
// production prompt, sealed JPEG inline, temperature 0, 16000 output tokens) and the out/<engine>/<slug>.txt +
// _meter.jsonl contract benchmark-score.mjs reads; realtime only. This sends that request through Batch.
/**
 * run-arms.mjs — Part A of #6293 (PREREGISTRATION-ocr-pareto-6293.md). Eval only: outputs go to the bench, NEVER to pages.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/ocr-pareto-6293/run-arms.mjs \
 *        --submit <model> [--set all|transport] [--cap-usd 8] [--dry-run]
 *   ... --collect [--poll-minutes 9]
 *
 * WORK=$JOB_SCRATCH (jobs.json, ledger.jsonl). Bench roots: <WORK>/bench (all pages), <WORK>/bench-transport (the
 * 40-page lite check; its engine dir is gemini-3.1-flash-lite-batch). Spend: before a submit, ledger (collected jobs)
 * + the estimate of every uncollected job + this one must stay ≤ --cap-usd.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';
import { MongoClient } from 'mongodb';
import { costOf, BATCH_MULTIPLIER } from '../../lib/model-pricing.mjs';
import { logUsage, completeBatchUsage, sumBatchResponseUsage } from '../../workers/lib/supabase-usage-logger.mjs';
import { getProductionOcrPrompt } from '../lib/production-prompt.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const W = process.env.JOB_SCRATCH || '/mnt/HC_Volume_105839809/jobs/ocr-pareto-6293';
const ENDPOINT = 'eval/ocr-pareto-6293';
const CAP = Number(opt('cap-usd', 8));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const LEDGER = path.join(W, 'ledger.jsonl'), JOBS = path.join(W, 'jobs.json');
const jobs = fs.existsSync(JOBS) ? JSON.parse(fs.readFileSync(JOBS, 'utf8')) : {};
const saveJobs = () => fs.writeFileSync(JOBS, JSON.stringify(jobs, null, 1));
const spent = () => jl(LEDGER).reduce((s, r) => s + r.usd, 0);
const pending = () => Object.values(jobs).filter((j) => !j.collected).reduce((s, j) => s + j.est_usd, 0);
const KEYS = [...new Set([process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2, process.env.GEMINI_API_KEY_3].filter(Boolean))];

// The request of the charted points (benchmark-run-api.mjs): generic prompt, or production v19.1 on latin-period-5126.
const GENERIC_PROMPT = 'Transcribe ALL text visible in this image using the appropriate Unicode script. '
  + 'Output ONLY the raw text. No commentary, no translation, no labels, no markdown.';
const PRODUCTION_STRATA = new Set(['latin-period-5126']);
const PRODUCTION_HASH = '9d8f959e053491362b2c4acec1e20c9a';
// Thinking as production's OCR request sets it (OCR_GENERATION_CONFIG: budget 0). 3.5 Flash-Lite refuses budget 0
// (400 INVALID_ARGUMENT, probed 2026-10-07 in #6182); 'minimal' is its lowest level.
const thinkingFor = (model) => (model === 'gemini-3.5-flash-lite' ? { thinkingLevel: 'minimal' } : { thinkingBudget: 0 });
const genConfig = (model) => ({ temperature: 0, maxOutputTokens: 16000, thinkingConfig: thinkingFor(model) });

const SEL = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'results', 'ocr-pareto-6293', 'pages.json'), 'utf8'));
const pageSet = (set) => (set === 'transport' ? SEL.transport_check.pages : [...new Set(Object.values(SEL.charts).flatMap((c) => c.pages))].sort());
const benchOf = (set) => path.join(W, set === 'transport' ? 'bench-transport' : 'bench');
const engineOf = (model, set) => (set === 'transport' ? `${model}-batch` : model);

// Estimate: each page's own stored lite tokens (same request), repriced for the model at Batch; thinking for
// 3.5 Flash-Lite is unknown, so its output is padded by 30 %.
function liteTokens(set) {
  const m = new Map();
  for (const k of pageSet(set)) {
    const [st, slug] = k.split('|');
    const row = jl(path.join(W, 'bench', st, 'out', 'gemini-3.1-flash-lite', '_meter.jsonl')).filter((r) => r.slug === slug).at(-1);
    m.set(k, row ? [row.inputTokens, row.outputTokens + (row.thinkingTokens || 0)] : [1403, 779]);
  }
  return m;
}
const estimate = (model, set) => [...liteTokens(set).values()].reduce((s, [i, o]) => s + costOf(model, i, o * (model === 'gemini-3.5-flash-lite' ? 1.3 : 1)), 0) * BATCH_MULTIPLIER;

async function submit(model, set) {
  const key = `${model}|${set}`;
  if (jobs[key]) { console.log(`${key}: already submitted (${jobs[key].name})`); return; }
  const keys = pageSet(set);
  const est = estimate(model, set);
  console.log(`${key}: ${keys.length} requests, est $${est.toFixed(3)} Batch; spent $${spent().toFixed(3)} + pending $${pending().toFixed(3)} of cap $${CAP}`);
  if (args.includes('--dry-run')) return;
  if (spent() + pending() + est > CAP) throw new Error(`CAP: would exceed $${CAP}`);
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const prod = await getProductionOcrPrompt(client.db('bookstore'));
  await client.close();
  if (prod.content_hash !== PRODUCTION_HASH) throw new Error(`production OCR prompt is ${prod.content_hash} (v${prod.version}), preregistered ${PRODUCTION_HASH} — stop`);
  const tmp = path.join(os.tmpdir(), `p6293-${model}-${set}-${Date.now().toString(36)}.jsonl`);
  const fd = fs.openSync(tmp, 'w');
  for (const k of keys) {
    const [st, slug] = k.split('|');
    const img = fs.readFileSync(path.join(benchOf(set), st, `${slug}.jpg`));
    const prompt = PRODUCTION_STRATA.has(st) ? prod.text : GENERIC_PROMPT;
    fs.writeSync(fd, JSON.stringify({ key: k, request: { contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: 'image/jpeg', data: img.toString('base64') } }] }], generationConfig: genConfig(model) } }) + '\n');
  }
  fs.closeSync(fd);
  console.log(`  request file ${(fs.statSync(tmp).size / 1e6).toFixed(0)} MB`);
  for (let k = 0; k < KEYS.length; k++) {
    try {
      const a = new GoogleGenAI({ apiKey: KEYS[k] });
      const file = await a.files.upload({ file: tmp, config: { mimeType: 'text/plain', displayName: `p6293-${model}-${set}` } });
      for (let i = 0; i < 60; i++) { const st = (await a.files.get({ name: file.name }))?.state; if (st === 'ACTIVE') break; if (st === 'FAILED') throw new Error('file FAILED'); await sleep(3000); }
      // usage-ok: eval harness — priced per response into the bench meter and metered on gemini_usage (estimate now, actuals at collect)
      const created = await a.batches.create({ model, src: { fileName: file.name }, config: { displayName: `${ENDPOINT} ${model} ${set}` } });
      const job = jobs[key] = { name: created.name, model, set, engine: engineOf(model, set), keyIndex: k, file: file.name, submitted_at: new Date().toISOString(), requests: keys.length, est_usd: est, config: genConfig(model) };
      saveJobs();
      await logUsage({ type: 'ocr', mode: 'batch', model, page_count: keys.length, input_tokens: 0, output_tokens: 0, cost_usd: Number(est.toFixed(6)), status: 'submitted', batch_job_id: created.name, endpoint: ENDPOINT, prompt_version: 'generic+v19.1', triggered_by: 'manual' });
      const { withMongo } = await import('../../lib/mongo.mjs');
      await withMongo((d) => d.collection('batch_jobs').updateOne({ gemini_job_name: created.name }, { $setOnInsert: {
        id: `ocr-pareto-6293-${model}-${set}`, job_name: created.name, gemini_job_name: created.name, status: 'external_eval', type: 'eval', model,
        page_count: keys.length, created_at: new Date(job.submitted_at), updated_at: new Date(), issue: 6293,
        note: 'hand-submitted eval Batch (scripts/eval/ocr-pareto-6293/run-arms.mjs); results go to files only, never to pages' } }, { upsert: true }));
      console.log(`${key}: submitted ${created.name} (key ${k}), registered external_eval`);
      break;
    } catch (e) {
      console.log(`${key}: key ${k} refused (${String(e.message).slice(0, 200)})`);
      if (k === KEYS.length - 1) throw e;
    }
  }
  fs.unlinkSync(tmp);
}

async function collect(pollMin) {
  const t0 = Date.now();
  for (;;) {
    const open = Object.entries(jobs).filter(([, j]) => !j.collected);
    if (!open.length) { console.log('no open jobs'); return; }
    for (const [key, job] of open) {
      const ai = new GoogleGenAI({ apiKey: KEYS[job.keyIndex] });
      const got = await ai.batches.get({ name: job.name });
      if (!/SUCCEEDED|FAILED|CANCELLED|EXPIRED/.test(got.state)) { console.log(`${key}: ${got.state}`); continue; }
      if (got.state !== 'JOB_STATE_SUCCEEDED') { console.log(`${key}: ${got.state}, not collected`); job.collected = got.state; job.usd = 0; saveJobs(); continue; }
      let responses = got.dest?.inlinedResponses || [];
      if (got.dest?.fileName) {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/${got.dest.fileName}:download?alt=media&key=${KEYS[job.keyIndex]}`);
        if (!r.ok) throw new Error(`download ${r.status}`);
        responses = (await r.text()).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
      }
      const { inputTokens, outputTokens } = sumBatchResponseUsage(responses);
      const at = new Date().toISOString();
      let usd = 0, n = 0, empty = 0, think = 0;
      const meters = new Map();
      for (const r of responses) {
        const k = r.key || r.metadata?.key; const [st, slug] = k.split('|'); const resp = r.response;
        const text = resp ? (resp.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('') : '';
        const um = resp?.usageMetadata || {};
        const c = costOf(job.model, um.promptTokenCount || 0, (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0)) * BATCH_MULTIPLIER;
        usd += c; think += um.thoughtsTokenCount || 0;
        const dir = path.join(benchOf(job.set), st, 'out', job.engine);
        fs.mkdirSync(dir, { recursive: true });
        // An empty transcription is a result (a blank page, a refusal): written, so the scorer sees it as read.
        if (resp) fs.writeFileSync(path.join(dir, `${slug}.txt`), text);
        if (!text.trim()) empty++; else n++;
        const row = { ...(PRODUCTION_STRATA.has(st) ? { prompt: 'production-v19.1', prompt_hash: PRODUCTION_HASH } : {}), slug, engine: job.engine, mode: 'batch', job: job.name,
          finishReason: resp?.candidates?.[0]?.finishReason || resp?.promptFeedback?.blockReason || null, inputTokens: um.promptTokenCount || 0, outputTokens: um.candidatesTokenCount || 0,
          thinkingTokens: um.thoughtsTokenCount || 0, costUsd: c, chars: text.length, error: resp ? null : JSON.stringify(r.error || r.status || 'no response').slice(0, 160), at };
        (meters.get(dir) || meters.set(dir, []).get(dir)).push(row);
      }
      for (const [dir, rows] of meters) fs.appendFileSync(path.join(dir, '_meter.jsonl'), rows.map((x) => JSON.stringify(x)).join('\n') + '\n');
      await completeBatchUsage({ type: 'ocr', mode: 'batch', model: job.model, page_count: job.requests, input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: Number(usd.toFixed(6)), status: 'success', batch_job_id: job.name, endpoint: ENDPOINT, triggered_by: 'manual' });
      fs.appendFileSync(LEDGER, JSON.stringify({ key, model: job.model, set: job.set, mode: 'batch', n: responses.length, in: inputTokens, out: outputTokens, thinking: think, usd, job: job.name, at }) + '\n');
      job.collected = got.state; job.usd = usd; job.written = n; job.empty = empty; job.thinking = think; job.responses = responses.length; saveJobs();
      try { await ai.files.delete({ name: job.file }); } catch { /* reaped by the sweeper */ }
      console.log(`${key}: collected ${responses.length} responses (${n} with text, ${empty} empty), thinking ${think}, $${usd.toFixed(4)} (${(usd / Math.max(1, responses.length) * 1000).toFixed(3)}/1K raw Batch)`);
    }
    if (Date.now() - t0 > pollMin * 60000) { console.log(`spent $${spent().toFixed(3)}, pending $${pending().toFixed(3)}`); return; }
    await sleep(30000);
  }
}

if (opt('submit')) await submit(opt('submit'), opt('set', 'all'));
if (args.includes('--collect')) await collect(Number(opt('poll-minutes', 9)));
console.log(`ledger $${spent().toFixed(3)}; pending (est) $${pending().toFixed(3)}`);
