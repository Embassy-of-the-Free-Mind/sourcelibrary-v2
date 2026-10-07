#!/usr/bin/env node
// PRIOR ART: scripts/eval/pareto-6182/run-arms.mjs — the Gemini Batch arms of #6182, from the prebuilt
// one-page requests in /root/pareto-6182/units.jsonl. Its submit/collect path is the Gemini Batch API only;
// the open and non-Gemini arms (Gemma 4 on the Gemini API, Qwen 3.6 and DeepSeek V4 on OpenRouter) are
// realtime chat calls with a different usage shape, so this sends the SAME unit prompt strings through
// those endpoints and writes rows in run-arms.mjs's arm-file shape (uid, arm, model, text, finish, in, out,
// thinking, usd_batch, date, config) so the #6182 scorer and chart generator read them unchanged.
/**
 * run-open-arms.mjs — open-model arms of #6182 (job pareto-open-6182). Eval only: outputs go to
 * /root/po6182/arms/<ARM>.jsonl, NEVER to pages.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/pareto-6182/run-open-arms.mjs \
 *        --arm GM31|GM26|QMX|QPL|Q27|DSP|DSF [--sets tib-ref58,tib-ref113] [--limit n] [--conc 4] [--cap-usd 5] [--or-cap-usd 0.35]
 *   ... --probe <ARM>      the 3 off-sample format-check pages (2 xl pages whose reference is withheld + 1 Tengyur side)
 *
 * Request: the unit's prompt string as the only user message, temperature 1.0, max output = the unit's
 * max_out, reasoning off where the provider allows it (production runs thinking 0); billed reasoning
 * tokens are recorded. OpenRouter cost is its billed `usage.cost` (no Batch tier for these models, so
 * usd_batch = the billed realtime cost). Gemma on the Gemini API bills $0; its row carries the tokens and
 * usd_list = the OpenRouter list price of the same model, which is what the frontier plots.
 */
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeTranslationTags, SAFETY_SETTINGS } from '../../lib/translate-core.mjs';
import { logUsage } from '../../workers/lib/supabase-usage-logger.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const U = '/root/pareto-6182/units.jsonl';
const W = '/root/po6182';
const ENDPOINT = 'eval/pareto-open-6182';
const CAP = Number(opt('cap-usd', 5));
const OR_CAP = Number(opt('or-cap-usd', 0.35));
const CONC = Number(opt('conc', 4));
const jl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const LEDGER = path.join(W, 'ledger.jsonl');
fs.mkdirSync(path.join(W, 'arms'), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Exact ids, read 2026-10-07 from the Gemini API model list and OpenRouter /api/v1/models.
// or_list: OpenRouter list price $/token [in, out], for the Gemma rows that the Gemini API bills at $0.
export const ARMS = {
  GM31: { via: 'gemini', model: 'gemma-4-31b-it', fallback: 'google/gemma-4-31b-it', or_list: [0.09e-6, 0.34e-6] },
  GM26: { via: 'gemini', model: 'gemma-4-26b-a4b-it', fallback: 'google/gemma-4-26b-a4b-it', or_list: [0.09e-6, 0.30e-6] },
  QMX: { via: 'openrouter', model: 'qwen/qwen3.6-max-preview' },
  QPL: { via: 'openrouter', model: 'qwen/qwen3.6-plus' },
  Q27: { via: 'openrouter', model: 'qwen/qwen3.6-27b' },
  DSP: { via: 'openrouter', model: 'deepseek/deepseek-v4-pro' },
  DSF: { via: 'openrouter', model: 'deepseek/deepseek-v4-flash' },
};

const ledger = () => jl(LEDGER);
const spent = () => ledger().reduce((s, r) => s + (r.usd || 0), 0);
const orSpent = () => ledger().filter((r) => r.via === 'openrouter').reduce((s, r) => s + (r.usd || 0), 0);

async function viaGemini(model, prompt, maxOut) {
  // usage-ok: eval arm, logged to gemini_usage below. Gemma 4 thinks by default (2-4K thought tokens a page, MAX_TOKENS
  // on the Tengyur, probed 2026-10-07); it refuses thinkingBudget and thinkingLevel 'low' (400) and runs at 0 thoughts
  // at thinkingLevel 'minimal' — production's thinking 0, as run-arms.mjs does for gemini-3.5-flash-lite.
  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 1.0, maxOutputTokens: maxOut, thinkingConfig: { thinkingLevel: 'minimal' } }, safetySettings: SAFETY_SETTINGS }),
  });
  const j = await resp.json();
  if (!resp.ok) throw Object.assign(new Error(`Gemini ${resp.status}: ${JSON.stringify(j).slice(0, 200)}`), { status: resp.status });
  const um = j.usageMetadata || {};
  const r = { text: (j.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join(''), in: um.promptTokenCount || 0, out: um.candidatesTokenCount || 0, thinking: um.thoughtsTokenCount || 0, finish: j.candidates?.[0]?.finishReason, usd: 0, provider: 'gemini-api' };
  await logUsage({ type: 'eval', mode: 'realtime', model, page_count: 1, input_tokens: r.in, output_tokens: r.out + r.thinking, status: 'success', endpoint: ENDPOINT, prompt_version: '13', triggered_by: 'manual' });
  return r;
}

// The one prompt-wrapper fix the job allows (#6182 open arms): a system line for the arms that echoed the source
// on the 2026-10-07 format probe (DSF, DSP, QMX). The user message — production's prompt — is unchanged.
export const WRAPPER = 'Return only what the instructions below ask for: the English translation of the page, with the tags they define. Do not reproduce the source-language text.';
const WRAPPED = new Set((process.env.PO_WRAPPED ?? 'DSF,DSP,QMX').split(',').filter(Boolean));

async function viaOpenRouter(model, prompt, maxOut, reasoning, wrap) {
  const body = { model, messages: [...(wrap ? [{ role: 'system', content: WRAPPER }] : []), { role: 'user', content: prompt }], temperature: 1.0, max_tokens: maxOut, usage: { include: true } };
  if (reasoning) body.reasoning = reasoning;
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'X-Title': 'sourcelibrary eval #6182' },
    body: JSON.stringify(body),
  });
  const j = await resp.json();
  if (!resp.ok || j.error) throw Object.assign(new Error(`OpenRouter ${resp.status}: ${JSON.stringify(j.error || j).slice(0, 240)}`), { status: j.error?.code || resp.status });
  const u = j.usage || {};
  const c = j.choices?.[0] || {};
  return { text: c.message?.content || '', in: u.prompt_tokens || 0, out: (u.completion_tokens || 0) - (u.completion_tokens_details?.reasoning_tokens || 0), thinking: u.completion_tokens_details?.reasoning_tokens || 0,
    finish: c.native_finish_reason || c.finish_reason, usd: u.cost || 0, provider: j.provider, gen_id: j.id };
}

// Reasoning off: production translates at thinking 0. Models that refuse it run at their lowest effort (recorded).
const REASONING = { GM31: { enabled: false }, GM26: { enabled: false }, QMX: { enabled: false }, QPL: { enabled: false }, Q27: { enabled: false }, DSP: { enabled: false }, DSF: { enabled: false } };

async function call(label, u) {
  const a = ARMS[label];
  if (spent() > CAP) throw new Error(`CAP: spent $${spent().toFixed(3)} > $${CAP}`);
  if (a.via === 'openrouter' && orSpent() > OR_CAP) throw new Error(`CAP: OpenRouter spent $${orSpent().toFixed(3)} > $${OR_CAP}`);
  let last, model = a.model, via = a.via;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = via === 'gemini' ? await viaGemini(model, u.prompt, u.max_out) : await viaOpenRouter(model, u.prompt, u.max_out, REASONING[label], WRAPPED.has(label));
      fs.appendFileSync(LEDGER, JSON.stringify({ arm: label, uid: u.uid, via, model, provider: r.provider, in: r.in, out: r.out, thinking: r.thinking, usd: r.usd, at: new Date().toISOString() }) + '\n');
      if (!r.text.trim()) throw new Error(`empty ${u.uid} (${r.finish})`);
      return { ...r, model, via };
    } catch (e) {
      last = e;
      if (String(e.message).startsWith('CAP') || e.status === 402) throw e;
      // Gemma: fall back to OpenRouter's google/gemma-4-* after repeated Gemini API refusals (quota).
      if (via === 'gemini' && attempt >= 2 && a.fallback) { via = 'openrouter'; model = a.fallback; }
      await sleep((e.status === 429 ? 20000 : 4000) * (attempt + 1));
    }
  }
  throw last;
}

function row(label, u, r) {
  const a = ARMS[label];
  const list = a.or_list ? r.in * a.or_list[0] + (r.out + r.thinking) * a.or_list[1] : null;
  const text = sanitizeTranslationTags(r.text.trim());
  return { uid: u.uid, arm: label, model: r.model, via: r.via, provider: r.provider || null, text, finish: r.finish, in: r.in, out: r.out, thinking: r.thinking,
    usd_billed: r.usd, usd_list: list, usd_batch: r.via === 'gemini' ? list : r.usd, date: new Date().toISOString().slice(0, 10), config: { temperature: 1.0, reasoning: REASONING[label] || null, wrapper: r.via === 'openrouter' && WRAPPED.has(label) }, format: formatCheck(text) };
}

// The output contract of the v13 prompt, checked mechanically (the format gate of the job brief).
export function formatCheck(t) {
  const issues = [];
  if (!t.trim()) issues.push('empty');
  if (/<think>|<\/think>/i.test(t)) issues.push('think-tags');
  if (/^\s*(here is|here's|sure|certainly|below is|the following|okay|ok,)/i.test(t)) issues.push('preamble');
  if (/```|`/.test(t)) issues.push('code');
  if (/\[[^\]\n]{0,200}\]/.test(t)) issues.push('square-brackets');
  const letters = (t.replace(/<[^>]+>/g, '').match(/\p{L}/gu) || []);
  const latin = letters.filter((c) => /[A-Za-z]/.test(c)).length;
  if (letters.length && latin / letters.length < 0.6) issues.push('not-english');
  // Echo: the response opens by reproducing the source (seen on DeepSeek V4, Greek verse, 2026-10-07 probes).
  const head = letters.slice(0, 300); if (head.length > 50 && head.filter((c) => /[A-Za-z]/.test(c)).length / head.length < 0.5) issues.push('echo');
  return { ok: !issues.some((x) => ['empty', 'think-tags', 'preamble', 'code', 'not-english', 'echo'].includes(x)), issues, house_tags: /<(term|gloss|note|meta)>/.test(t) };
}

async function pool(items, fn) {
  const q = [...items]; const errs = [];
  await Promise.all(Array.from({ length: CONC }, async () => {
    for (let it = q.shift(); it; it = q.shift()) {
      try { await fn(it); } catch (e) { errs.push(String(e.message)); if (String(e.message).startsWith('CAP') || e.status === 402) q.length = 0; }
    }
  }));
  return errs;
}

async function main() {
  const label = opt('probe') || opt('arm');
  if (!ARMS[label]) { console.error(`--arm ${Object.keys(ARMS).join('|')}`); process.exit(1); }
  let units, file;
  if (opt('probe')) {
    units = jl(path.join(W, 'probe-units.jsonl'));
    file = path.join(W, 'arms', `probe-${label}.jsonl`);
  } else {
    const sets = opt('sets', 'tib-ref58,tib-ref113').split(',');
    units = jl(U).filter((u) => sets.includes(u.set));
    if (opt('limit')) units = units.slice(0, Number(opt('limit')));
    file = path.join(W, 'arms', `${label}.jsonl`);
  }
  const done = new Set(jl(file).map((x) => x.uid));
  const todo = units.filter((u) => !done.has(u.uid));
  console.log(`${label} (${ARMS[label].model}): ${todo.length} to do, ${done.size} done; spent $${spent().toFixed(4)} (OpenRouter $${orSpent().toFixed(4)})`);
  const errs = await pool(todo, async (u) => {
    const r = await call(label, u);
    const o = row(label, u, r);
    fs.appendFileSync(file, JSON.stringify(o) + '\n');
    if (opt('probe')) console.log(`  ${u.uid} ${o.model} via ${o.via}/${o.provider}: in ${o.in} out ${o.out} think ${o.thinking} finish ${o.finish} $${(o.usd_billed || 0).toFixed(5)} format ${JSON.stringify(o.format)} | ${o.text.slice(0, 100).replace(/\n/g, ' ')}`);
  });
  const out = jl(file);
  const bill = out.reduce((s, x) => s + (x.usd_batch || 0), 0);
  console.log(`${label}: ${out.length} rows, format ok ${out.filter((x) => x.format.ok).length}; errors ${errs.length}${errs.length ? ` (${[...new Set(errs)].slice(0, 3).join(' | ')})` : ''}; $/1K ${(bill / out.length * 1000).toFixed(2)}; spent $${spent().toFixed(4)} (OpenRouter $${orSpent().toFixed(4)})`);
}
await main();
