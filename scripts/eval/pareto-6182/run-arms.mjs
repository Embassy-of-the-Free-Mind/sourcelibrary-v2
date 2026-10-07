#!/usr/bin/env node
// PRIOR ART: scripts/eval/tibetan-mt-ab/batch-arms.mjs — one Batch job per model, metered and registered
// as external_eval; its request is built from Mongo ids with neighbouring OCR. This keeps its submit,
// poll, meter and register code, and reads the prebuilt one-page requests of units.mjs instead, so every
// arm of #6182 sends the byte-identical prompt. scripts/eval/tengyur-levers/run-arms.mjs is the
// realtime twin (round 2's G38/G35), kept for the --probe path.
/**
 * run-arms.mjs — the arms of #6182. Eval only: outputs go to /root/pareto-6182/arms/<ARM>.jsonl, NEVER to pages.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/pareto-6182/run-arms.mjs \
 *        --arm <LABEL> [--model <id>|prod] [--sets tib-ref113,xl] [--cap-usd 20] [--poll-minutes 9] [--dry-run]
 *   ... --probe <model> [--n 2]      realtime, on xl pages that have no reference (never judged)
 *
 * --model prod sends each page to the engine production routes its book to (the A-vs-A arm), one job per model.
 * Request: the unit's prompt, temperature 1.0 (Gemini 3's default, as the stored English ran), thinking
 * budget 0 (Pro: 128, the lowest it accepts), SAFETY_SETTINGS, maxOutputTokens from the page (+8192 for Pro).
 * Spend: before any submit, the ledger (/root/pareto-6182/ledger.jsonl: realtime calls and collected jobs)
 * plus the estimate of every job not yet collected plus this one must stay under --cap-usd.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { sanitizeTranslationTags, SAFETY_SETTINGS } from '../../lib/translate-core.mjs';
import { costOf, BATCH_MULTIPLIER } from '../../lib/model-pricing.mjs';
import { callGemini } from '../../lib/gemini-script-client.mjs';
import { logUsage, completeBatchUsage, sumBatchResponseUsage } from '../../workers/lib/supabase-usage-logger.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const W = '/root/pareto-6182';
const ENDPOINT = 'eval/pareto-6182';
const CAP = Number(opt('cap-usd', 20));
const PRO = 'gemini-3.1-pro-preview';
const PRO_THINK = 128;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const LEDGER = path.join(W, 'ledger.jsonl'), JOBS = path.join(W, 'jobs.json');
fs.mkdirSync(path.join(W, 'arms'), { recursive: true });
const jobs = fs.existsSync(JOBS) ? JSON.parse(fs.readFileSync(JOBS, 'utf8')) : {};
const saveJobs = () => fs.writeFileSync(JOBS, JSON.stringify(jobs, null, 1));
const spent = () => jl(LEDGER).reduce((s, r) => s + r.usd, 0);
const pending = () => Object.values(jobs).filter((j) => !j.collected).reduce((s, j) => s + j.est_usd, 0);
// gemini-3.5-flash-lite refuses thinkingBudget 0 (400 INVALID_ARGUMENT, probed 2026-10-07); 'minimal' is its lowest level.
const thinkingFor = (model) => (model === PRO ? { thinkingBudget: PRO_THINK } : model === 'gemini-3.5-flash-lite' ? { thinkingLevel: 'minimal' } : { thinkingBudget: 0 });
const genConfig = (model, maxOut) => ({ temperature: 1.0, maxOutputTokens: maxOut + (model === PRO ? 8192 : 0), thinkingConfig: thinkingFor(model) });
// Estimate, kept above the probes (2026-10-07: ~2.6 prompt chars per input token; output ≈ 0.15 × max; Pro billed
// 0–2,362 thinking tokens a page at budget 128, so 1,500 are added) — the cap check uses it for jobs not yet collected.
const estimate = (model, us, batch = true) => us.reduce((s, u) => s + costOf(model, u.prompt.length / 2.5, u.max_out * 0.15 + (model === PRO ? 1500 : 0)), 0) * (batch ? BATCH_MULTIPLIER : 1);
const KEYS = [...new Set([process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2, process.env.GEMINI_API_KEY_3].filter(Boolean))];

async function probe(model, n) {
  // Off-sample: xl pages whose reference is withheld (never judged), first n in file order.
  const recs = jl(path.join(W, 'xl', 'records.jsonl')).filter((r) => !r.reference_text).slice(0, n);
  const { PAGE_BREAK_SCOPED, buildTranslationPrompt } = await import('../../lib/translate-core.mjs');
  const { maxOutputTokensFor } = await import('../../lib/translate-batch-seam.mjs');
  const state = JSON.parse(fs.readFileSync('/root/tref/arms/state.json', 'utf8'));
  for (const r of recs) {
    const prompt = buildTranslationPrompt({ prompts: state.prompts, book: r.book, ocrText: r.ocr_text, pageBreak: PAGE_BREAK_SCOPED }).prompt;
    const maxOut = maxOutputTokensFor([{ ocr: { data: r.ocr_text } }]);
    if (spent() + pending() + estimate(model, [{ prompt, max_out: maxOut }], false) > CAP) throw new Error('CAP');
    const g = genConfig(model, maxOut);
    let res;
    if (g.thinkingConfig.thinkingBudget != null) {
      res = await callGemini({ model, prompt, endpoint: ENDPOINT, type: 'eval', bookId: r.book_id, promptVersion: 'v13', triggeredBy: 'pareto-6182-probe',
        safetySettings: SAFETY_SETTINGS, maxOutputTokens: g.maxOutputTokens, temperature: 1.0, thinkingBudget: g.thinkingConfig.thinkingBudget });
    } else {
      // A thinkingLevel the script client does not pass: the same request by hand, metered the same way.
      // usage-ok: eval probe, logged to gemini_usage below
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEYS[0]}`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: g, safetySettings: SAFETY_SETTINGS }) });
      const j = await resp.json();
      if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${JSON.stringify(j).slice(0, 200)}`);
      const um = j.usageMetadata || {};
      res = { text: (j.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join(''), inputTokens: um.promptTokenCount || 0, outputTokens: (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0), thinkingTokens: um.thoughtsTokenCount || 0, finishReason: j.candidates?.[0]?.finishReason };
      await logUsage({ type: 'eval', mode: 'realtime', model, page_count: 1, input_tokens: res.inputTokens, output_tokens: res.outputTokens, status: 'success', endpoint: ENDPOINT, prompt_version: '13', triggered_by: 'manual' });
    }
    const usd = costOf(model, res.inputTokens, res.outputTokens); // outputTokens already includes thinking (outputTokensFrom)
    fs.appendFileSync(LEDGER, JSON.stringify({ arm: `probe-${model}`, model, mode: 'realtime', n: 1, in: res.inputTokens, out: res.outputTokens, thinking: res.thinkingTokens || 0, usd, at: new Date().toISOString() }) + '\n');
    console.log(`${model} ${r.id}: in ${res.inputTokens} out ${res.outputTokens} thinking ${res.thinkingTokens || 0} finish ${res.finishReason} $${usd.toFixed(4)}; ${/<meta>|<term>/.test(res.text) ? 'house tags' : 'NO house tags'}; ${res.text.slice(0, 80).replace(/\n/g, ' ')}`);
  }
}

async function batchArm(label, modelOpt, sets) {
  const all = jl(path.join(W, 'units.jsonl')).filter((u) => sets.includes(u.set));
  const outFile = path.join(W, 'arms', `${label}.jsonl`);
  const done = new Set(jl(outFile).map((x) => x.uid));
  const todo = all.filter((u) => !done.has(u.uid));
  const groups = {};
  for (const u of todo) (groups[modelOpt === 'prod' ? u.prod_model : modelOpt] ||= []).push(u);
  for (const [model, us] of Object.entries(groups)) {
    const key = `${label}|${model}|${sets.join(',')}`;
    let job = jobs[key];
    const ai = () => new GoogleGenAI({ apiKey: KEYS[job?.keyIndex ?? 0] });
    if (!job) {
      const est = estimate(model, us);
      console.log(`${key}: ${us.length} requests, est $${est.toFixed(3)} Batch; spent $${spent().toFixed(3)} + pending $${pending().toFixed(3)} of cap $${CAP}`);
      if (args.includes('--dry-run')) continue;
      if (spent() + pending() + est > CAP) throw new Error(`CAP: would exceed $${CAP}`);
      const lines = us.map((u) => JSON.stringify({ key: u.uid, request: { contents: [{ role: 'user', parts: [{ text: u.prompt }] }], generationConfig: genConfig(model, u.max_out), safetySettings: SAFETY_SETTINGS } }));
      const tmp = path.join(os.tmpdir(), `p6182-${label}-${model}-${Date.now().toString(36)}.jsonl`);
      fs.writeFileSync(tmp, lines.join('\n') + '\n');
      for (let k = 0; k < KEYS.length; k++) {
        try {
          const a = new GoogleGenAI({ apiKey: KEYS[k] });
          const file = await a.files.upload({ file: tmp, config: { mimeType: 'text/plain', displayName: `p6182-${label}` } });
          for (let i = 0; i < 30; i++) { const st = (await a.files.get({ name: file.name }))?.state; if (st === 'ACTIVE') break; if (st === 'FAILED') throw new Error('file FAILED'); await sleep(2000); }
          // usage-ok: eval harness — priced per response into the arm file and metered on gemini_usage (placeholder now, completed at collect)
          const created = await a.batches.create({ model, src: { fileName: file.name }, config: { displayName: `${ENDPOINT} ${label} ${model}` } });
          try { await a.files.delete({ name: file.name }); } catch { /* reaped by the sweeper */ }
          job = jobs[key] = { name: created.name, label, model, keyIndex: k, submitted_at: new Date().toISOString(), requests: us.length, est_usd: est, uids: us.map((u) => u.uid) };
          saveJobs();
          await logUsage({ type: 'translation', mode: 'batch', model, page_count: us.length, input_tokens: 0, output_tokens: 0, status: 'submitted', batch_job_id: created.name, endpoint: ENDPOINT, prompt_version: '13', triggered_by: 'manual' });
          const { withMongo } = await import('../../lib/mongo.mjs');
          await withMongo((d) => d.collection('batch_jobs').updateOne({ gemini_job_name: created.name }, { $setOnInsert: {
            id: `pareto-6182-${label}-${model}`, job_name: created.name, gemini_job_name: created.name, status: 'external_eval', type: 'eval', model,
            page_count: us.length, created_at: new Date(job.submitted_at), updated_at: new Date(), issue: 6182,
            note: 'hand-submitted eval Batch (scripts/eval/pareto-6182/run-arms.mjs); results go to files only, never to pages' } }, { upsert: true }));
          console.log(`${key}: submitted ${created.name} (key ${k}), registered external_eval`);
          break;
        } catch (e) {
          console.log(`${key}: key ${k} refused (${String(e.message).slice(0, 160)})`);
          if (k === KEYS.length - 1) throw e;
        }
      }
      fs.unlinkSync(tmp);
    }
  }
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
      await completeBatchUsage({ type: 'translation', mode: 'batch', model: job.model, page_count: job.requests, input_tokens: inputTokens, output_tokens: outputTokens, status: 'success', batch_job_id: job.name, endpoint: ENDPOINT, triggered_by: 'manual' });
      const outFile = path.join(W, 'arms', `${job.label}.jsonl`);
      const date = new Date().toISOString().slice(0, 10);
      let usd = 0, n = 0, think = 0, fail = 0;
      for (const r of responses) {
        const uid = r.key || r.metadata?.key; const resp = r.response;
        const text = resp ? sanitizeTranslationTags((resp.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('').trim()) : '';
        const um = resp?.usageMetadata || {};
        const c = costOf(job.model, um.promptTokenCount || 0, (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0)) * BATCH_MULTIPLIER;
        usd += c; think += um.thoughtsTokenCount || 0;
        if (!text) { fail++; continue; }
        n++;
        fs.appendFileSync(outFile, JSON.stringify({ uid, arm: job.label, model: job.model, text, finish: resp.candidates?.[0]?.finishReason, in: um.promptTokenCount, out: um.candidatesTokenCount, thinking: um.thoughtsTokenCount || 0, usd_batch: c, job: job.name, date, config: thinkingFor(job.model) }) + '\n');
      }
      fs.appendFileSync(LEDGER, JSON.stringify({ arm: job.label, model: job.model, mode: 'batch', n: responses.length, in: inputTokens, out: outputTokens, thinking: think, usd, job: job.name, at: new Date().toISOString() }) + '\n');
      job.collected = got.state; job.usd = usd; job.written = n; job.failed = fail; job.thinking = think; saveJobs();
      console.log(`${key}: collected ${n} written, ${fail} empty, thinking ${think}, $${usd.toFixed(4)} (${(usd / Math.max(1, n) * 1000).toFixed(2)}/1K Batch)`);
    }
    if (Date.now() - t0 > pollMin * 60000) { console.log(`spent $${spent().toFixed(3)}, pending $${pending().toFixed(3)}`); return; }
    await sleep(30000);
  }
}

if (opt('probe')) await probe(opt('probe'), Number(opt('n', 2)));
else if (opt('arm')) await batchArm(opt('arm'), opt('model', 'prod'), opt('sets', 'tib-ref58,tib-ref113,tib-rev,xl').split(','));
if (args.includes('--collect')) await collect(Number(opt('poll-minutes', 9)));
console.log(`ledger $${spent().toFixed(3)}; pending (est) $${pending().toFixed(3)}`);
