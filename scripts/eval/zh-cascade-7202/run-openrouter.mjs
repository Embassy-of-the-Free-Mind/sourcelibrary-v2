#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-model-ab.mjs callOpenRouter() (2026-09-14, the DeepSeek/Qwen arms: reasoning off,
// OpenRouter's own charge requested) — not exported, and that file runs its CLI on import, so its request is repeated
// here over #7202's prebuilt units. The Lite arms use scripts/eval/pareto-6182/run-arms.mjs (--work) on the same units.
/**
 * One OpenRouter arm over <work>/units.jsonl → <work>/arms/<arm>.jsonl. Eval only, nothing written to the database.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/zh-cascade-7202/run-openrouter.mjs \
 *        --work $JOB_SCRATCH/work --arm deepseek --model deepseek/deepseek-v4-flash [--cap-usd 4] [--concurrency 3]
 *
 * Sends `prompt_or` (the v13 prompt + gates.mjs RESIDUE_RULE), temperature 1, reasoning { enabled: false },
 * max_tokens = the unit's max_out (≤ 8192), usage.include so the reply carries the charge. Every row records OpenRouter's
 * reported cost and the provider that served it (the LAST row per page wins; --retry-cut resends cut replies), and is appended to <work>/ledger.jsonl, which the Lite runner's cap
 * check reads too. Refuses to send once the ledger reaches --cap-usd. A page already written is skipped on restart.
 */
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeTranslationTags } from '../../lib/translate-core.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const W = opt('work'); const ARM = opt('arm'); const MODEL = opt('model');
const CAP = Number(opt('cap-usd', 4)); const CONC = Number(opt('concurrency', 3));
if (!W || !ARM || !MODEL) { console.error('--work --arm --model required'); process.exit(1); }
const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('OPENROUTER_API_KEY not set'); process.exit(1); }
const jl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const LEDGER = path.join(W, 'ledger.jsonl'); const OUT = path.join(W, 'arms', `${ARM}.jsonl`);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const spent = () => jl(LEDGER).reduce((s, r) => s + (r.usd || 0), 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(prompt, maxTokens) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}`, 'HTTP-Referer': 'https://sourcelibrary.org', 'X-Title': 'Source Library translation eval #7202' },
        body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens, temperature: 1, reasoning: { enabled: false }, usage: { include: true } }),
        signal: AbortSignal.timeout(300000),
      });
      const j = await r.json();
      if (r.ok && !j.error) {
        const c = j.choices?.[0]; const u = j.usage || {};
        return { text: c?.message?.content || '', finish: c?.finish_reason || null, provider: j.provider || null, in: u.prompt_tokens || 0, out: u.completion_tokens || 0,
          reasoning: u.completion_tokens_details?.reasoning_tokens || 0, cost_reported: typeof u.cost === 'number' ? u.cost : null };
      }
      const status = r.status || j.error?.code;
      if (status === 429 || status >= 500) { await sleep(5000 * (attempt + 1)); continue; }
      return { error: `HTTP ${status}: ${JSON.stringify(j).slice(0, 300)}` };
    } catch (e) {
      if (attempt === 3) return { error: String(e.message || e).slice(0, 300) };
      await sleep(5000 * (attempt + 1));
    }
  }
  return { error: 'retries exhausted' };
}

// --retry-cut: send again the pages whose LAST row ended with finish 'error' (a stream the provider cut mid-reply; it is
// billed $0 and is not a translation). The last row per page is the arm's text.
const last = new Map(jl(OUT).map((r) => [r.uid, r]));
const done = new Set([...last.values()].filter((r) => r.text && !(args.includes('--retry-cut') && r.finish === 'error')).map((r) => r.uid));
const queue = jl(path.join(W, 'units.jsonl')).filter((u) => !done.has(u.uid));
console.log(`${ARM} (${MODEL}): ${queue.length} to send; ledger $${spent().toFixed(4)} of cap $${CAP}`);
let stop = false, n = 0, usd = 0;
await Promise.all(Array.from({ length: CONC }, async () => {
  while (queue.length && !stop) {
    const u = queue.shift();
    if (spent() >= CAP) { stop = true; console.log(`STOP: ledger $${spent().toFixed(4)} >= cap $${CAP}`); break; }
    const t0 = Date.now();
    const r = await call(u.prompt_or, Math.min(8192, u.max_out));
    const text = r.text ? sanitizeTranslationTags(r.text.trim()) : '';
    const row = { uid: u.uid, arm: ARM, model: MODEL, text, finish: r.finish ?? null, provider: r.provider ?? null, in: r.in ?? 0, out: r.out ?? 0, reasoning: r.reasoning ?? 0,
      cost_reported: r.cost_reported ?? null, error: r.error ?? null, prompt: 'v13 + RESIDUE_RULE (gates.mjs)', ms: Date.now() - t0, date: new Date().toISOString() };
    fs.appendFileSync(OUT, JSON.stringify(row) + '\n');
    if (r.cost_reported) { fs.appendFileSync(LEDGER, JSON.stringify({ arm: ARM, model: MODEL, mode: 'openrouter', n: 1, uid: u.uid, usd: r.cost_reported, at: row.date }) + '\n'); usd += r.cost_reported; }
    n++;
    console.log(`  ${u.uid} ${r.error ? `ERROR ${r.error.slice(0, 100)}` : `${text.length} chars, ${r.finish}, ${r.provider}, $${(r.cost_reported ?? 0).toFixed(5)}`}`);
  }
}));
console.log(`${ARM}: ${n} sent, $${usd.toFixed(4)} reported; ledger $${spent().toFixed(4)}`);
