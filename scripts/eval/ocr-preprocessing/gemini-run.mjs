#!/usr/bin/env node
// PRIOR ART: scripts/eval/en-ocr-reference-5124.mjs (production prompt + metered flash-lite reads + store rows) and
// scripts/eval/benchmark-run-api.mjs (resumable per-engine output dirs). This keeps the engine, prompt and params fixed
// and varies only the IMAGE (#5250 arms), through scripts/lib/gemini-script-client.mjs so every call is metered.
//
// Run from the repo root (it resolves mongodb + the libs there):
//   node --env-file=.env.production.local scripts/eval/ocr-preprocessing/gemini-run.mjs <dir> [--max-cost 4.5] [--conc 6] [--only none,none-repeat]
// <dir> holds pages.jsonl and img/<arm>/<slug>.jpg (gemini-prep.py). Writes out/<arm>/<slug>.txt and calls.jsonl.
// Jobs run A/A first (none + none-repeat on the first 30 pages of each stratum), then the other arms, page-major.
// Realtime, not batch: the metered client is realtime-only and the whole run is ~$2 (issue cap $5).
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { callGemini } from '../../lib/gemini-script-client.mjs';
import { getProductionOcrPrompt } from '../lib/production-prompt.mjs';
import { priceFor } from '../../lib/model-pricing.mjs';
import { OCR_MODEL_LITE } from '../../lib/ocr-routing.mjs';

const args = process.argv.slice(2);
const dir = args[0];
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const MAX_COST = Number(opt('max-cost', 4.5));
const CONC = Number(opt('conc', 6));
const ONLY = opt('only', '') ? new Set(opt('only').split(',')) : null;
const ARMS = ['none', 'otsu', 'sauvola', 'clahe', 'deskew', 'upscale2x'];
const N_REPEAT = 30;

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const prompt = await getProductionOcrPrompt(client.db('bookstore'));
await client.close();
const promptHash = createHash('sha256').update(prompt.text).digest('hex').slice(0, 16);
const model = OCR_MODEL_LITE;
const price = priceFor(model);

const pages = readFileSync(`${dir}/pages.jsonl`, 'utf8').split('\n').filter(Boolean).map(JSON.parse)
  .filter((p) => existsSync(`${dir}/img/none/${p.slug}.jpg`));
const seen = {};
const jobs = [];
for (const p of pages) { seen[p.stratum] = (seen[p.stratum] || 0) + 1; p.repeat = seen[p.stratum] <= N_REPEAT; }
for (const p of pages.filter((q) => q.repeat)) jobs.push([p, 'none', 'none'], [p, 'none-repeat', 'none']);
for (const p of pages) for (const a of ARMS) if (!(p.repeat && a === 'none')) jobs.push([p, a, a]);
const todo = jobs.filter(([p, arm]) => (!ONLY || ONLY.has(arm)) && !existsSync(`${dir}/out/${arm}/${p.slug}.txt`));

let spent = 0, i = 0, done = 0;
for (const l of existsSync(`${dir}/calls.jsonl`) ? readFileSync(`${dir}/calls.jsonl`, 'utf8').split('\n').filter(Boolean) : []) spent += JSON.parse(l).cost_usd || 0;
console.log(`model=${model} prompt=${prompt.name} v${prompt.version} hash=${promptHash} jobs=${todo.length} spent_so_far=$${spent.toFixed(4)}`);

async function worker() {
  while (i < todo.length) {
    if (spent >= MAX_COST) { console.log(`STOP: cost cap $${MAX_COST} reached ($${spent.toFixed(4)})`); return; }
    const [p, arm, imgArm] = todo[i++];
    const buf = readFileSync(`${dir}/img/${imgArm}/${p.slug}.jpg`);
    const t0 = Date.now();
    let r, err = null;
    try {
      r = await callGemini({ model, prompt: prompt.text, endpoint: 'eval/ocr-preprocessing-5250', imageParts: [{ mimeType: 'image/jpeg', data: buf }],
        temperature: 0, maxOutputTokens: 8000, type: 'ocr', promptVersion: prompt.version, triggeredBy: 'eval-5250' });
    } catch (e) { err = String(e?.message || e).slice(0, 300); }
    const cost = r ? ((r.inputTokens || 0) * price.input + ((r.outputTokens || 0) + (r.thinkingTokens || 0)) * price.output) / 1e6 : 0;
    spent += cost;
    const text = r?.text || '';
    const fin = r?.finishReason || null;
    const outcome = err ? 'error' : fin === 'RECITATION' || fin === 'SAFETY' ? 'refusal' : fin === 'MAX_TOKENS' ? 'truncated' : text.trim() ? 'text' : 'empty';
    mkdirSync(`${dir}/out/${arm}`, { recursive: true });
    if (outcome !== 'error') writeFileSync(`${dir}/out/${arm}/${p.slug}.txt`, text);
    appendFileSync(`${dir}/calls.jsonl`, JSON.stringify({ slug: p.slug, stratum: p.stratum, arm, model, prompt_id: `${prompt.name}-v${prompt.version}`,
      prompt_hash: promptHash, finish_reason: fin, outcome, err, input_tokens: r?.inputTokens ?? null, output_tokens: r?.outputTokens ?? null,
      thinking_tokens: r?.thinkingTokens ?? null, cost_usd: +cost.toFixed(6), latency_ms: Date.now() - t0, chars: text.length,
      text_hash: text ? createHash('sha256').update(text).digest('hex').slice(0, 16) : null, at: new Date().toISOString() }) + '\n');
    if (++done % 50 === 0) console.log(`${done}/${todo.length} spent=$${spent.toFixed(4)}`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
console.log(`DONE ${done}/${todo.length} spent=$${spent.toFixed(4)}`);
