#!/usr/bin/env node
/**
 * latin-r4-gemini-5924.mjs — the Gemini arms of round 4 of #5660 (Latin print, #5924) through the Batch API.
 *
 * PRIOR ART: benchmark-run-api.mjs — the realtime runner whose GENERIC prompt and request shape (prompt text, then the
 * bench JPEG as is; temperature 0; maxOutputTokens 16000; thinkingBudget 0) this copies, so round-3 lite outputs and
 * these are on one footing; it has no Batch mode (prereg Amendment 3 M: every Gemini arm goes through Batch).
 * ocr-v18-ab.mjs stageSubmit / stagePoll — the REST upload → batchGenerateContent → collect loop and outcomeOf are
 * imported; its MODEL is fixed, so the per-model submit is here. ocr-tags-5830.mjs registerJobs — the batch_jobs
 * `external_eval` row (#5771), copied.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/latin-r4-gemini-5924.mjs <stage> --root=<bench root> --work=<dir>
 *     build   requests-<arm>.jsonl per arm from <work>/arms.json ({ arm: { model, engine, slugs: [stratum/slug …], thinking } })
 *             + estimate.json (input tokens from countTokens on a sample, output from round-3 lite outputs)
 *     submit  --approved-usd=N   refuses above N or above the $7 hard cap; registers each job in batch_jobs
 *     poll    collect into <root>/<stratum>/out/<engine>/<slug>.txt + _meter.jsonl (finishReason per slug); exit 0 when done
 * Never writes to books or pages.
 */
import fs from 'fs';
import path from 'path';
import { outcomeOf } from './ocr-v18-ab.mjs';

const STAGE = process.argv[2];
const args = Object.fromEntries(process.argv.slice(3).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const ROOT = args.root, WORK = args.work; const F = n => path.join(WORK, n);
const API = 'https://generativelanguage.googleapis.com';
const HARD_CAP_USD = 7;
const GENERIC_PROMPT = 'Transcribe ALL text visible in this image using the appropriate Unicode script. '
  + 'Output ONLY the raw text. No commentary, no translation, no labels, no markdown.';
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const key = () => { const k = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY; if (!k) throw new Error('no Gemini key'); return k; };
const keyEnv = () => (process.env.GEMINI_API_KEY_TIER3 ? 'GEMINI_API_KEY_TIER3' : 'GEMINI_API_KEY');

function request(arm, file) {
  const generationConfig = { temperature: 0, maxOutputTokens: arm.thinking === 'default' ? 32000 : 16000 };
  if (arm.thinking !== 'default') generationConfig.thinkingConfig = { thinkingBudget: 0 };
  return { contents: [{ parts: [{ text: GENERIC_PROMPT }, { inline_data: { mime_type: 'image/jpeg', data: fs.readFileSync(file).toString('base64') } }] }], generationConfig };
}

async function build() {
  const arms = readJson(F('arms.json'));
  const { priceFor, BATCH_MULTIPLIER } = await import('../lib/model-pricing.mjs');
  // input tokens per page: countTokens (free) on 6 pages per model; output: round-3/this-round lite chars ÷ 3.2 per page,
  // plus, for a thinking arm, the measured thoughts of a realtime probe is NOT taken (it would be spend): 2,500 assumed
  const est = { at: new Date().toISOString(), prompt: GENERIC_PROMPT, arms: {}, usd: 0 };
  for (const [name, arm] of Object.entries(arms)) {
    const out = fs.createWriteStream(F(`requests-${name}.jsonl`)); let n = 0;
    for (const s of arm.slugs) { const [st, slug] = s.split('/'); out.write(JSON.stringify({ key: `${name}:${st}/${slug}:1`, request: request(arm, path.join(ROOT, st, `${slug}.jpg`)) }) + '\n'); n++; }
    await new Promise(r => out.end(r));
    const sample = arm.slugs.filter((_, i) => i % Math.max(1, Math.floor(arm.slugs.length / 6)) === 0).slice(0, 6);
    let tin = 0;
    for (const s of sample) {
      const [st, slug] = s.split('/'); const body = request(arm, path.join(ROOT, st, `${slug}.jpg`));
      const r = await fetch(`${API}/v1beta/models/${arm.model}:countTokens?key=${key()}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: body.contents }) });
      const j = await r.json(); if (!r.ok) throw new Error(`countTokens ${arm.model} ${r.status} ${JSON.stringify(j).slice(0, 200)}`); tin += j.totalTokens;
    }
    const inPer = tin / sample.length;
    const outPer = Number(args['out-tokens'] || 900) + (arm.thinking === 'default' ? Number(args['think-tokens'] || 2500) : 0);
    const p = priceFor(arm.model);
    const usd = BATCH_MULTIPLIER * n * (inPer * p.input + outPer * p.output) / 1e6;
    est.arms[name] = { model: arm.model, engine: arm.engine, requests: n, in_tokens_per_page: Math.round(inPer), out_tokens_per_page_assumed: outPer, thinking: arm.thinking || 'off (thinkingBudget 0)', usd: +usd.toFixed(4) };
    est.usd += usd;
  }
  est.usd = +est.usd.toFixed(4);
  fs.writeFileSync(F('estimate.json'), JSON.stringify(est, null, 1));
  console.log(JSON.stringify(est.arms, null, 1)); console.log(`ESTIMATE $${est.usd} (batch, half price)`);
}

async function submit() {
  const est = readJson(F('estimate.json')); const approved = Number(args['approved-usd'] || 0);
  if (est.usd > HARD_CAP_USD) { console.error(`REFUSING: estimate $${est.usd} over the $${HARD_CAP_USD} hard cap`); process.exit(2); }
  if (!(approved >= est.usd)) { console.error(`REFUSING TO SPEND: estimate $${est.usd}, --approved-usd=${approved || 'absent'}`); process.exit(2); }
  const { createThenDeleteInput } = await import('../lib/gemini-batch-input-file.mjs');
  const bf = F('batch.json'); const rec = fs.existsSync(bf) ? readJson(bf) : { key_env: keyEnv(), estimate_usd: est.usd, jobs: [] };
  const k = process.env[rec.key_env];
  for (const [name, a] of Object.entries(est.arms)) {
    if (rec.jobs.some(j => j.arm === name)) { console.log(`${name}: already submitted`); continue; }
    const file = F(`requests-${name}.jsonl`); const bytes = fs.statSync(file).size; const display = `latin-r4-5924-${name}`;
    const start = await fetch(`${API}/upload/v1beta/files?key=${k}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(bytes), 'X-Goog-Upload-Header-Content-Type': 'text/plain' }, body: JSON.stringify({ file: { displayName: display } }) });
    if (!start.ok) throw new Error(`upload start ${start.status} ${(await start.text()).slice(0, 300)}`);
    const up = await fetch(start.headers.get('X-Goog-Upload-URL'), { method: 'PUT', headers: { 'Content-Type': 'text/plain', 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0' }, body: fs.readFileSync(file) });
    if (!up.ok) throw new Error(`upload ${up.status} ${(await up.text()).slice(0, 300)}`);
    const fileName = (await up.json()).file?.name; if (!fileName) throw new Error('upload response missing file.name');
    for (let i = 0; i < 30; i++) { const st = await (await fetch(`${API}/v1beta/${fileName}?key=${k}`)).json(); if (st.state === 'ACTIVE') break; if (st.state === 'FAILED') throw new Error(`file ${fileName} FAILED`); await new Promise(r => setTimeout(r, 2000)); }
    // thinking-ok: every line sets thinkingConfig { thinkingBudget: 0 } except the Pro arm, whose default thinking is preregistered and metered in poll
    const job = await createThenDeleteInput({ fileName, apiKey: k, create: async () => {
      const r = await fetch(`${API}/v1beta/models/${a.model}:batchGenerateContent?key=${k}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batch: { display_name: display, input_config: { file_name: fileName } } }) });
      if (!r.ok) throw new Error(`batch create ${r.status} ${(await r.text()).slice(0, 500)}`); return r.json();
    } });
    rec.jobs.push({ arm: name, model: a.model, engine: a.engine, job_name: job.name, requests: a.requests, bytes, submitted_at: new Date().toISOString() });
    fs.writeFileSync(bf, JSON.stringify(rec, null, 1));
    await register(rec.jobs.at(-1));
    console.log(`submitted ${name} → ${job.name} (${a.requests} requests)`);
  }
}
/** #5771: a hand-submitted Batch unknown to batch_jobs is an orphan, and the sweeper cancels it. */
async function register(j) {
  const { withMongo } = await import('../lib/mongo.mjs');
  const { registerEvalBatch } = await import('../lib/eval-batch-registry.mjs');
  await withMongo(db => registerEvalBatch(db, {
    jobName: j.job_name, id: `latin-r4-5924-${j.arm}`, submittedBy: 'scripts/eval/latin-r4-gemini-5924.mjs',
    model: j.model, pageCount: j.requests, submittedAt: new Date(j.submitted_at), issue: 5924,
    note: 'hand-submitted eval Batch; results go to files only, never to pages' }));
  console.log(`registered ${j.arm} ${j.job_name} as external_eval`);
}

async function poll() {
  const bf = F('batch.json'); const rec = readJson(bf); const k = process.env[rec.key_env];
  const { priceFor, BATCH_MULTIPLIER } = await import('../lib/model-pricing.mjs');
  let pending = 0;
  for (const j of rec.jobs) {
    if (j.collected_at || j.terminal_state) continue;
    const data = await (await fetch(`${API}/v1beta/${j.job_name}?key=${k}`)).json();
    const state = data.metadata?.state || data.state;
    console.log(`${new Date().toISOString()} ${j.arm} ${state} ${JSON.stringify(data.metadata?.batchStats || {})}`);
    if (/FAILED|CANCELLED|EXPIRED/.test(state || '')) { j.terminal_state = state; fs.writeFileSync(bf, JSON.stringify(rec, null, 1)); continue; }
    const rf = data.metadata?.output?.responsesFile || data.response?.responsesFile; if (!rf) { pending++; continue; }
    const text = await (await fetch(`${API}/download/v1beta/${rf}:download?alt=media&key=${k}`)).text();
    let inTok = 0, outTok = 0, thinkTok = 0; const outcomes = {}; const p = priceFor(j.model);
    for (const line of text.split('\n').filter(Boolean)) {
      const r = JSON.parse(line); const [, ss] = (r.key || r.metadata?.key).split(':'); const [st, slug] = ss.split('/');
      const o = outcomeOf(r), u = r.response?.usageMetadata || {};
      const dir = path.join(ROOT, st, 'out', j.engine); fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${slug}.txt`), o.raw || '');
      const it = u.promptTokenCount || 0, ot = u.candidatesTokenCount || 0, tt = u.thoughtsTokenCount || 0;
      inTok += it; outTok += ot; thinkTok += tt; outcomes[o.outcome] = (outcomes[o.outcome] || 0) + 1;
      fs.appendFileSync(path.join(dir, '_meter.jsonl'), JSON.stringify({ slug, engine: j.engine, finishReason: o.finish || (o.outcome === 'error' ? 'error' : null), outcome: o.outcome, inputTokens: it, outputTokens: ot, thinkingTokens: tt, costUsd: BATCH_MULTIPLIER * (it * p.input + (ot + tt) * p.output) / 1e6, mode: 'batch', model_version: r.response?.modelVersion || null, error: o.error || null, chars: (o.raw || '').length, at: new Date().toISOString() }) + '\n');
    }
    Object.assign(j, { collected_at: new Date().toISOString(), outcomes, in_tokens: inTok, out_tokens: outTok, thinking_tokens: thinkTok, cost_usd: BATCH_MULTIPLIER * (inTok * p.input + (outTok + thinkTok) * p.output) / 1e6 });
    try {
      const { logUsage } = await import('../workers/lib/supabase-usage-logger.mjs');
      await logUsage({ type: 'eval', mode: 'batch', model: j.model, page_count: Object.values(outcomes).reduce((a, b) => a + b, 0), input_tokens: inTok, output_tokens: outTok + thinkTok, batch_job_id: j.job_name, endpoint: 'eval/latin-r4-5924', triggered_by: 'manual', prompt_version: `eval-5924-${j.arm}` });
      j.usage_logged = true;
    } catch (e) { j.usage_logged = false; console.warn(`logUsage failed: ${e.message}`); }
    fs.writeFileSync(bf, JSON.stringify(rec, null, 1));
    console.log(`collected ${j.arm}: ${JSON.stringify(outcomes)} $${j.cost_usd.toFixed(4)} (thinking tokens ${thinkTok})`);
  }
  const total = rec.jobs.reduce((s, j) => s + (j.cost_usd || 0), 0);
  console.log(pending ? `${pending} pending; collected $${total.toFixed(4)}` : `ALL-TERMINAL actual $${total.toFixed(4)}`);
  process.exitCode = pending ? 3 : 0;
}

const STAGES = { build, submit, poll };
if (!STAGES[STAGE] || !ROOT || !WORK) { console.error('usage: build|submit|poll --root=<bench root> --work=<dir>'); process.exit(1); }
await STAGES[STAGE]();
