#!/usr/bin/env node
// PRIOR ART: scripts/eval/pareto-6182/run-arms.mjs — one Gemini Batch job per (arm, model), metered on
// gemini_usage and registered in batch_jobs as external_eval, outputs to files only. Its submit/collect/meter
// code is kept; it reads one fixed units file of TEXT prompts, and #6295 also needs image OCR requests
// (prompt + the page image inline, production's OCR generation config), so the unit carries an optional image.
/**
 * run-batch.mjs — the paid Gemini arms of #6295 (Syriac OCR and translation Pareto). Eval only: outputs go to
 * <work>/arms/<ARM>.jsonl, NEVER to pages. Every request is a Batch request.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/syriac-pareto-6295/run-batch.mjs \
 *        --work <dir> --units <units.jsonl> --arm <LABEL> --model <id> [--kind ocr|translate] [--cap-usd 1] [--dry-run]
 *   ... --work <dir> --collect [--poll-minutes 9]
 *
 * Unit: { uid, prompt, image?: <jpeg path>, max_out }.
 *   ocr        production's OCR request (scripts/batch/bulk-reocr-local.mjs): [prompt text, inline image],
 *              temperature 0.1, maxOutputTokens 16384, thinkingBudget 0.
 *   translate  production's one-page translation request as #6182 sent it (pareto-6182/run-arms.mjs):
 *              temperature 1.0, maxOutputTokens from the page, thinkingBudget 0.
 * Thinking budget 0 (3.5-flash-lite: level 'minimal', the lowest it accepts). Thinking is CHECKED, not assumed: thoughtsTokenCount is recorded per response and billed at the output rate.
 * Spend: before any submit, ledger (collected jobs) + estimate of open jobs + this job must stay under --cap-usd.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { sanitizeTranslationTags, SAFETY_SETTINGS } from '../../lib/translate-core.mjs';
import { costOf, BATCH_MULTIPLIER } from '../../lib/model-pricing.mjs';
import { logUsage, completeBatchUsage, sumBatchResponseUsage } from '../../workers/lib/supabase-usage-logger.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const W = opt('work');
if (!W) throw new Error('--work <dir> is required');
const ENDPOINT = 'eval/syriac-pareto-6295';
const CAP = Number(opt('cap-usd', 1));
// Spend rule (Derek, 2026-10-08, #6295): the ONLY Gemini model this job may call on the paid API is
// gemini-3.1-flash-lite. Every other Gemini tier runs through the CLI on the subscription (PR #6277), never here.
const API_MODELS = new Set(['gemini-3.1-flash-lite']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const LEDGER = path.join(W, 'ledger.jsonl'), JOBS = path.join(W, 'jobs.json');
fs.mkdirSync(path.join(W, 'arms'), { recursive: true });
const jobs = fs.existsSync(JOBS) ? JSON.parse(fs.readFileSync(JOBS, 'utf8')) : {};
const saveJobs = () => fs.writeFileSync(JOBS, JSON.stringify(jobs, null, 1));
const spent = () => jl(LEDGER).reduce((s, r) => s + r.usd, 0);
const pending = () => Object.values(jobs).filter((j) => !j.collected).reduce((s, j) => s + j.est_usd, 0);
const KEYS = [...new Set([process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2, process.env.GEMINI_API_KEY_3].filter(Boolean))];

// gemini-3.5-flash-lite refuses thinkingBudget 0 (400 INVALID_ARGUMENT, probed 2026-10-07 in #6182); 'minimal' is its lowest level.
const thinkingFor = (model) => (model === 'gemini-3.5-flash-lite' ? { thinkingLevel: 'minimal' } : { thinkingBudget: 0 });
const genConfig = (kind, model, maxOut) => (kind === 'ocr'
  ? { temperature: 0.1, maxOutputTokens: 16384, thinkingConfig: thinkingFor(model) }
  : { temperature: 1.0, maxOutputTokens: maxOut, thinkingConfig: thinkingFor(model) });
// Estimate (kept above the probes): an image ≈ 1,300 input tokens; text ≈ 2.5 chars per token; output ≈ 0.3 × max
// for translation, 3,000 tokens for an OCR page (Syriac is ~1 token per letter).
const estimate = (model, kind, us) => us.reduce((s, u) => s + costOf(model, u.prompt.length / 2.5 + (u.image ? 1300 : 0), kind === 'ocr' ? 3000 : u.max_out * 0.3), 0) * BATCH_MULTIPLIER;

async function submit(label, model, kind, units) {
  const outFile = path.join(W, 'arms', `${label}.jsonl`);
  const done = new Set(jl(outFile).map((x) => x.uid));
  const us = units.filter((u) => !done.has(u.uid));
  if (!API_MODELS.has(model)) throw new Error(`${model}: not allowed on the paid API (spend rule 2026-10-08, #6295) — run it through the CLI harness`);
  const key = `${label}|${model}`;
  if (jobs[key] && !jobs[key].collected) { console.log(`${key}: already open (${jobs[key].name})`); return; }
  if (!us.length) { console.log(`${key}: nothing to do`); return; }
  const est = estimate(model, kind, us);
  console.log(`${key}: ${us.length} requests, est $${est.toFixed(3)} Batch; spent $${spent().toFixed(3)} + pending $${pending().toFixed(3)} of cap $${CAP}`);
  if (args.includes('--dry-run')) return;
  if (spent() + pending() + est > CAP) throw new Error(`CAP: would exceed $${CAP}`);
  const lines = us.map((u) => {
    const parts = [{ text: u.prompt }];
    if (u.image) parts.push({ inlineData: { mimeType: 'image/jpeg', data: fs.readFileSync(u.image).toString('base64') } });
    return JSON.stringify({ key: u.uid, request: { contents: [{ role: 'user', parts }], generationConfig: genConfig(kind, model, u.max_out), safetySettings: SAFETY_SETTINGS } });
  });
  const tmp = path.join(os.tmpdir(), `s6295-${label}-${Date.now().toString(36)}.jsonl`);
  fs.writeFileSync(tmp, lines.join('\n') + '\n');
  for (let k = 0; k < KEYS.length; k++) {
    try {
      const a = new GoogleGenAI({ apiKey: KEYS[k] });
      const file = await a.files.upload({ file: tmp, config: { mimeType: 'text/plain', displayName: `s6295-${label}` } });
      for (let i = 0; i < 30; i++) { const st = (await a.files.get({ name: file.name }))?.state; if (st === 'ACTIVE') break; if (st === 'FAILED') throw new Error('file FAILED'); await sleep(2000); }
      // usage-ok: eval harness — priced per response into the arm file and metered on gemini_usage (placeholder now, completed at collect)
      const created = await a.batches.create({ model, src: { fileName: file.name }, config: { displayName: `${ENDPOINT} ${label} ${model}` } });
      try { await a.files.delete({ name: file.name }); } catch { /* reaped by the sweeper */ }
      jobs[key] = { name: created.name, label, model, kind, keyIndex: k, submitted_at: new Date().toISOString(), requests: us.length, est_usd: est };
      saveJobs();
      await logUsage({ type: kind === 'ocr' ? 'ocr' : 'translation', mode: 'batch', model, page_count: us.length, input_tokens: 0, output_tokens: 0, status: 'submitted', batch_job_id: created.name, endpoint: ENDPOINT, triggered_by: 'manual' });
      const { withMongo } = await import('../../lib/mongo.mjs');
      await withMongo((d) => d.collection('batch_jobs').updateOne({ gemini_job_name: created.name }, { $setOnInsert: {
        id: `syriac-pareto-6295-${label}`, job_name: created.name, gemini_job_name: created.name, status: 'external_eval', type: 'eval', model,
        page_count: us.length, created_at: new Date(), updated_at: new Date(), issue: 6295,
        note: 'hand-submitted eval Batch (scripts/eval/syriac-pareto-6295/run-batch.mjs); results go to files only, never to pages' } }, { upsert: true }));
      console.log(`${key}: submitted ${created.name} (key ${k}), registered external_eval`);
      break;
    } catch (e) {
      console.log(`${key}: key ${k} refused (${String(e.message).slice(0, 160)})`);
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
      if (got.state !== 'JOB_STATE_SUCCEEDED') { console.log(`${key}: ${got.state} — not collected`); job.collected = got.state; saveJobs(); continue; }
      let responses = got.dest?.inlinedResponses || [];
      if (got.dest?.fileName) {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/${got.dest.fileName}:download?alt=media&key=${KEYS[job.keyIndex]}`);
        if (!r.ok) throw new Error(`download ${r.status}`);
        responses = (await r.text()).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
      }
      const { inputTokens, outputTokens } = sumBatchResponseUsage(responses);
      await completeBatchUsage({ type: job.kind === 'ocr' ? 'ocr' : 'translation', mode: 'batch', model: job.model, page_count: job.requests, input_tokens: inputTokens, output_tokens: outputTokens, status: 'success', batch_job_id: job.name, endpoint: ENDPOINT, triggered_by: 'manual' });
      const outFile = path.join(W, 'arms', `${job.label}.jsonl`);
      const date = new Date().toISOString().slice(0, 10);
      let usd = 0, n = 0, think = 0, fail = 0;
      for (const r of responses) {
        const uid = r.key || r.metadata?.key; const resp = r.response;
        const raw = resp ? (resp.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('').trim() : '';
        const text = job.kind === 'ocr' ? raw : sanitizeTranslationTags(raw);
        const um = resp?.usageMetadata || {};
        const c = costOf(job.model, um.promptTokenCount || 0, (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0)) * BATCH_MULTIPLIER;
        usd += c; think += um.thoughtsTokenCount || 0;
        if (!text) fail++; else n++;
        fs.appendFileSync(outFile, JSON.stringify({ uid, arm: job.label, model: job.model, model_version: resp?.modelVersion || null, text, finish: resp?.candidates?.[0]?.finishReason || null, in: um.promptTokenCount, out: um.candidatesTokenCount, thinking: um.thoughtsTokenCount || 0, usd_batch: c, job: job.name, date, error: r.error || null }) + '\n');
      }
      fs.appendFileSync(LEDGER, JSON.stringify({ arm: job.label, model: job.model, mode: 'batch', n: responses.length, in: inputTokens, out: outputTokens, thinking: think, usd, job: job.name, at: new Date().toISOString() }) + '\n');
      job.collected = got.state; job.usd = usd; job.written = n; job.failed = fail; job.thinking = think; saveJobs();
      console.log(`${key}: collected ${n} with text, ${fail} empty, thinking ${think}, $${usd.toFixed(4)} (${(usd / Math.max(1, responses.length) * 1000).toFixed(2)}/1K Batch)`);
    }
    if (Date.now() - t0 > pollMin * 60000) { console.log(`spent $${spent().toFixed(3)}, pending $${pending().toFixed(3)}`); return; }
    await sleep(30000);
  }
}

if (opt('arm')) await submit(opt('arm'), opt('model'), opt('kind', 'ocr'), jl(opt('units')));
if (args.includes('--collect')) await collect(Number(opt('poll-minutes', 9)));
console.log(`ledger $${spent().toFixed(3)}; pending (est) $${pending().toFixed(3)}`);
