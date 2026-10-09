#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-notes-free/run-arms.mjs (#5919) — the realtime door used here (callGemini on a
// pseudo-book envelope, resumable, refuses past a cap); scripts/eval/langid-5777.mjs — the Batch submit/collect shape
// (upload, createThenDeleteInput, responses file, logUsage). Neither runs a text detector over an items file.
/** Run the #5982 additions detector over an items file, realtime or on the Batch API, metered on envelope additions-5982. */
/**
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/untagged-additions/run.mjs \
 *     --in <items.jsonl> --out <out.jsonl> [--model gemini-3.1-flash-lite] [--max-usd 5] [--concurrency 6]
 *     [--batch-submit | --batch-collect [--wait-min 9]]   (Batch: state in <out>.batch.json; then a realtime run fills the unanswered)
 * Items: {id, source, translation, prev?, next?, source_kind?: 'ocr'|'typed'}. Out: one row per item with units and flags.
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { callGemini } from '../../lib/gemini-script-client.mjs';
import { costOf, priceFor, BATCH_MULTIPLIER } from '../../lib/model-pricing.mjs';
import { getScopeSpendUsd } from '../../lib/spend-guard.mjs';
import { createThenDeleteInput } from '../../lib/gemini-batch-input-file.mjs';
import { buildPrompt, parseFlags, sentenceUnits, generationConfig, PROMPT_VERSION, MAX_UNITS } from './detector.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const has = (n) => args.includes(`--${n}`);
const IN = opt('in'), OUT = opt('out');
const MODEL = opt('model', 'gemini-3.1-flash-lite');
const MAX_USD = Number(opt('max-usd', 5));
const CONC = Number(opt('concurrency', 6));
const ENVELOPE = 'additions-5982';
const ENDPOINT = 'scripts/eval/untagged-additions/run.mjs';
const API = 'https://generativelanguage.googleapis.com';
if (!IN || !OUT) { console.error('--in and --out are required'); process.exit(1); }

const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
const items = readJsonl(IN);
const done = new Set(readJsonl(OUT).filter((r) => !r.error).map((r) => r.id));
const todo = items.filter((it) => !done.has(it.id));
console.log(`${items.length} items, ${done.size} answered, ${todo.length} to run on ${MODEL}`);

const prep = (it) => {
  const units = sentenceUnits(it.translation);
  return { units, prompt: units.length ? buildPrompt({ source: it.source, units, prevTail: it.prev || '', nextHead: it.next || '', sourceKind: it.source_kind || 'ocr' }) : null };
};
const row = (it, units, text, usage, mode) => {
  const parsed = parseFlags(text, Math.min(units.length, MAX_UNITS));
  return { id: it.id, model: MODEL, mode, prompt_version: PROMPT_VERSION, source_kind: it.source_kind || 'ocr', n_units: units.length, units, ...(parsed ? { checkable: parsed.checkable, flags: parsed.flags, dropped: parsed.dropped } : { error: `unparseable: ${String(text).slice(0, 200)}` }), ...usage };
};
const append = (r) => fs.appendFileSync(OUT, JSON.stringify(r) + '\n');

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const ctl = await db.collection('system_config').findOne({ _id: 'processing_control' });
const env = ctl?.allow_scopes?.[ENVELOPE];
if (!env?.created_at) { await c.close(); throw new Error(`envelope ${ENVELOPE} missing — refusing to spend`); }
const metered = async () => { const s = await getScopeSpendUsd(db, { ids: [ENVELOPE], since: new Date(env.created_at) }); if (s.meterError) throw new Error(`envelope meter unreadable: ${s.meterError}`); return s.usd; };
let envUsd = await metered(); let runUsd = 0;
console.log(`envelope ${ENVELOPE}: measured $${envUsd.toFixed(3)} / cap $${MAX_USD}`);

const BATCH_REC = `${OUT}.batch.json`;
const loadRec = () => (fs.existsSync(BATCH_REC) ? JSON.parse(fs.readFileSync(BATCH_REC, 'utf8')) : { model: MODEL, jobs: [] });
const keyEnv = () => (process.env.GEMINI_API_KEY_TIER3 ? 'GEMINI_API_KEY_TIER3' : 'GEMINI_API_KEY');

try {
  if (has('batch-submit')) {
    const rec = loadRec();
    if (rec.jobs.some((j) => !j.collected_at)) throw new Error('uncollected job in the batch record; run --batch-collect first');
    const reqs = todo.map((it) => ({ it, ...prep(it) })).filter((x) => x.prompt);
    const p = priceFor(MODEL);
    const estimate = reqs.reduce((s, x) => s + BATCH_MULTIPLIER * ((x.prompt.length / 3.2 / 1e6) * p.input + ((80 + x.units.length * 8) / 1e6) * p.output), 0);
    console.log(`batch: ${reqs.length} requests, estimate $${estimate.toFixed(3)}`);
    if (envUsd + estimate > MAX_USD - 0.05) throw new Error(`estimate would pass the cap: envelope $${envUsd.toFixed(3)} + $${estimate.toFixed(3)}`);
    const envName = keyEnv(), key = process.env[envName];
    const jsonl = reqs.map((x) => JSON.stringify({ key: x.it.id, request: { contents: [{ parts: [{ text: x.prompt }] }], generationConfig: generationConfig(x.units.length) } })).join('\n');
    const bytes = Buffer.byteLength(jsonl);
    const name = `additions-5982-${Date.now()}`;
    const start = await fetch(`${API}/upload/v1beta/files?key=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(bytes), 'X-Goog-Upload-Header-Content-Type': 'text/plain' }, body: JSON.stringify({ file: { display_name: name } }) });
    if (!start.ok) throw new Error(`upload start ${start.status} ${(await start.text()).slice(0, 300)}`);
    const up = await fetch(start.headers.get('X-Goog-Upload-URL'), { method: 'PUT', headers: { 'Content-Type': 'text/plain', 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0' }, body: jsonl });
    if (!up.ok) throw new Error(`upload ${up.status} ${(await up.text()).slice(0, 300)}`);
    const fileName = (await up.json()).file?.name;
    const job = await createThenDeleteInput({ fileName, apiKey: key, create: async () => {
      const r = await fetch(`${API}/v1beta/models/${MODEL}:batchGenerateContent?key=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batch: { display_name: name, input_config: { file_name: fileName } } }) });
      if (!r.ok) throw new Error(`batch create ${r.status} ${(await r.text()).slice(0, 500)}`);
      return r.json();
    } });
    rec.key_env = envName;
    rec.jobs.push({ job_name: job.name, requests: reqs.length, estimate_usd: +estimate.toFixed(4), submitted_at: new Date().toISOString() });
    fs.writeFileSync(BATCH_REC, JSON.stringify(rec, null, 1));
    console.log(`submitted ${job.name}`);
  } else if (has('batch-collect')) {
    const rec = loadRec(); const key = process.env[rec.key_env];
    const byId = new Map(items.map((it) => [it.id, it]));
    const waitMax = Number(opt('wait-min', 0)) * 60e3, t0 = Date.now();
    const p = priceFor(MODEL);
    for (;;) {
      let pending = 0;
      for (const j of rec.jobs) {
        if (j.collected_at) continue;
        const data = await (await fetch(`${API}/v1beta/${j.job_name}?key=${key}`)).json();
        const state = data.metadata?.state || data.state;
        const rf = data.metadata?.output?.responsesFile || data.response?.responsesFile;
        console.log(`${j.job_name} ${state} ${JSON.stringify(data.metadata?.batchStats || {})}`);
        if (!rf && /FAILED|CANCELLED|EXPIRED/.test(state || '')) { Object.assign(j, { collected_at: new Date().toISOString(), state, responses: 0, cost_usd: 0 }); fs.writeFileSync(BATCH_REC, JSON.stringify(rec, null, 1)); continue; }
        if (!rf) { pending++; continue; }
        const text = await (await fetch(`${API}/download/v1beta/${rf}:download?alt=media&key=${key}`)).text();
        let inTok = 0, outTok = 0, n = 0, errors = 0;
        for (const line of text.split('\n').filter(Boolean)) {
          const r = JSON.parse(line); const id = r.key || r.metadata?.key; const it = byId.get(id); if (!it || done.has(id)) continue;
          const resp = r.response, u = resp?.usageMetadata || {};
          if (r.error || !resp) { errors++; continue; } // unanswered: the realtime pass picks it up
          const out = (resp.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('');
          const i = u.promptTokenCount || 0, o = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
          inTok += i; outTok += o;
          const rr = row(it, sentenceUnits(it.translation), out, { inputTokens: i, outputTokens: o, cost_usd: BATCH_MULTIPLIER * costOf(MODEL, i, o), finishReason: resp.candidates?.[0]?.finishReason || null }, 'batch');
          if (rr.error) errors++; else done.add(id);
          append(rr); n++;
        }
        Object.assign(j, { collected_at: new Date().toISOString(), state, responses: n, errors, in_tokens: inTok, out_tokens: outTok, cost_usd: +(BATCH_MULTIPLIER * ((inTok / 1e6) * p.input + (outTok / 1e6) * p.output)).toFixed(5) });
        console.log(`collected ${n} (${errors} errors) $${j.cost_usd}`);
        const { logUsage } = await import('../../workers/lib/supabase-usage-logger.mjs');
        await logUsage({ type: 'eval', mode: 'batch', model: MODEL, book_id: ENVELOPE, page_count: n - errors, input_tokens: inTok, output_tokens: outTok, cost_usd: j.cost_usd, batch_job_id: j.job_name, endpoint: ENDPOINT, triggered_by: 'additions-5982', prompt_version: PROMPT_VERSION });
        fs.writeFileSync(BATCH_REC, JSON.stringify(rec, null, 1));
      }
      if (!pending) { console.log('all collected'); break; }
      if (Date.now() - t0 > waitMax) { console.log(`${pending} job(s) pending; re-run --batch-collect`); break; }
      await new Promise((r) => setTimeout(r, 30e3));
    }
  } else {
    const queue = [...todo];
    const one = async (it) => {
      const { units, prompt } = prep(it);
      if (!prompt) { append({ id: it.id, model: MODEL, mode: 'none', prompt_version: PROMPT_VERSION, source_kind: it.source_kind || 'ocr', n_units: 0, units: [], checkable: false, flags: [], cost_usd: 0 }); return; }
      if (envUsd + runUsd > MAX_USD - 0.05) throw new Error(`spend cap: envelope $${envUsd.toFixed(3)} + run $${runUsd.toFixed(3)} ≥ $${MAX_USD}`);
      for (let attempt = 1; ; attempt++) {
        try {
          const res = await callGemini({ model: MODEL, prompt, endpoint: ENDPOINT, thinkingBudget: 0, temperature: 0, maxOutputTokens: generationConfig(units.length).maxOutputTokens, type: 'eval', bookId: ENVELOPE, pageIds: [it.id], promptVersion: PROMPT_VERSION, triggeredBy: 'additions-5982' });
          const cost_usd = costOf(MODEL, res.inputTokens, res.outputTokens); runUsd += cost_usd;
          append(row(it, units, res.text, { inputTokens: res.inputTokens, outputTokens: res.outputTokens, cost_usd, finishReason: res.finishReason }, 'realtime'));
          return;
        } catch (err) {
          if (attempt >= 4 || !/(503|429|500|overloaded|UNAVAILABLE|fetch failed)/i.test(String(err.message))) { append({ id: it.id, model: MODEL, error: String(err.message).slice(0, 300) }); console.log(`${it.id} FAILED ${String(err.message).slice(0, 100)}`); return; }
          await new Promise((ok) => setTimeout(ok, 4000 * attempt));
        }
      }
    };
    await Promise.all(Array.from({ length: CONC }, async () => { while (queue.length) await one(queue.shift()); }));
    console.log(`realtime: spent (computed) $${runUsd.toFixed(4)}`);
  }
} finally {
  try { envUsd = await metered(); } catch {}
  await c.close();
}
console.log(`envelope measured $${envUsd.toFixed(3)}`);
process.exit(0);
