#!/usr/bin/env node
// PRIOR ART: run-arms.mjs (this directory) submits the Gemini arms of #6182 as Gemini Batch jobs from
// units.jsonl and writes arms/<LABEL>.jsonl; scripts/eval/lib/runners.mjs runClaudeOpenRouter calls Claude
// realtime through OpenRouter's chat/completions. Neither reaches OpenRouter's Batch API (POST /api/v1/batches,
// half price, text only), which is the only route to the `:batch` prices, so this submits the same units
// there and writes the same arm-file shape for the judges and the chart generator.
/**
 * claude-arms.mjs — the Claude arms of #6182 (PREREG-claude-arms.md). Eval only: outputs go to files, NEVER to pages.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/pareto-6182/claude-arms.mjs \
 *        --arm CS|CH|CO [--sets tib-ref58,tib-ref113,xl] [--uids co30|fmt3] [--tag <suffix>] [--cap-usd 10] [--dry-run]
 *   ... --collect [--poll-minutes 9]
 *
 * --uids co30: PREREG-claude-arms' 30 tib-ref58 sides (sha256('6182:'+page_id) order); fmt3: the first 3 of them.
 * Arm files: /root/pareto-claude-6182/arms/<LABEL><tag>.jsonl (copied into /root/pareto-6182/arms/ on delivery).
 * Spend: the ledger (billed usage.cost of collected batches) + estimates of open batches + this one ≤ --cap-usd,
 * and ≤ the account's remaining OpenRouter credit.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { sanitizeTranslationTags } from '../../lib/translate-core.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const W = '/root/pareto-claude-6182', UNITS = '/root/pareto-6182/units.jsonl';
const CAP = Number(opt('cap-usd', 10));
const OR = 'https://openrouter.ai/api/v1';
const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) throw new Error('OPENROUTER_API_KEY not set');
const H = { 'content-type': 'application/json', authorization: `Bearer ${KEY}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
fs.mkdirSync(path.join(W, 'arms'), { recursive: true });
const LEDGER = path.join(W, 'ledger.jsonl'), JOBS = path.join(W, 'jobs.json');
const jobs = fs.existsSync(JOBS) ? JSON.parse(fs.readFileSync(JOBS, 'utf8')) : {};
const saveJobs = () => fs.writeFileSync(JOBS, JSON.stringify(jobs, null, 1));
const spent = () => jl(LEDGER).reduce((s, r) => s + r.usd, 0);
const pending = () => Object.values(jobs).filter((j) => !j.collected).reduce((s, j) => s + j.est_usd, 0);

// Batch list prices, $/M tokens (OpenRouter model list, 2026-10-07).
const ARMS = {
  CS: { model: 'anthropic/claude-sonnet-5.5', in: 1, out: 5 },
  CH: { model: 'anthropic/claude-haiku-4.5', in: 1, out: 5, rt_in: 1, rt_out: 5, realtime: true }, // see realtime()
  CO: { model: 'anthropic/claude-opus-5.5', in: 2, out: 10 },
};
// The lowest thinking each model accepts (PREREG-claude-arms): THINK env overrides for the format check.
const THINK = {
  CS: process.env.THINK_CS ? JSON.parse(process.env.THINK_CS) : { thinking: { type: 'between_tools' } }, // runners.mjs: Sonnet 5.5 turns thinking off this way
  CH: {},
  CO: { output_config: { effort: 'low' } },
};
const THINK_HEADROOM = { CS: process.env.THINK_CS ? 8192 : 0, CH: 0, CO: 8192 };

function co30() {
  const ids = jl(UNITS).filter((u) => u.set === 'tib-ref58').map((u) => u.uid);
  const h = (s) => crypto.createHash('sha256').update(`6182:${s}`).digest('hex');
  return ids.sort((a, b) => (h(a) < h(b) ? -1 : 1)).slice(0, 30);
}

async function credit() {
  const j = await (await fetch(`${OR}/credits`, { headers: H })).json();
  return j.data.total_credits - j.data.total_usage;
}

async function submit(label, sets, uidSel, tag) {
  const cfg = ARMS[label];
  let units = jl(UNITS);
  if (uidSel) { const want = uidSel === 'co30' ? co30() : co30().slice(0, 3); units = want.map((id) => units.find((u) => u.uid === id)); }
  else units = units.filter((u) => sets.includes(u.set));
  const name = `${label}${tag}`;
  const done = new Set(jl(path.join(W, 'arms', `${name}.jsonl`)).map((x) => x.uid));
  units = units.filter((u) => !done.has(u.uid));
  if (!units.length) { console.log(`${name}: nothing to do`); return; }
  // Estimate: ~3 prompt chars per Claude token (Tibetan heavier, so 2.5), output 0.2 × max_out, + 1,500 thinking where on.
  const est = units.reduce((s, u) => s + (u.prompt.length / 2.5) * cfg.in / 1e6 + (u.max_out * 0.2 + (THINK_HEADROOM[label] ? 1500 : 0)) * cfg.out / 1e6, 0);
  const cr = await credit();
  console.log(`${name}: ${units.length} requests, est $${est.toFixed(3)}; spent $${spent().toFixed(3)} + pending $${pending().toFixed(3)} of cap $${CAP}; credit $${cr.toFixed(2)}`);
  if (args.includes('--dry-run')) return;
  if (spent() + pending() + est > CAP) throw new Error(`CAP: would exceed $${CAP}`);
  if (est * 1.5 > cr) throw new Error(`CREDIT: est $${est.toFixed(2)} × 1.5 > remaining credit $${cr.toFixed(2)}`);
  if (cfg.realtime) return realtime(label, name, cfg, units);
  const requests = units.map((u) => ({ custom_id: u.uid, body: {
    model: cfg.model, max_tokens: u.max_out + THINK_HEADROOM[label], ...THINK[label],
    messages: [{ role: 'user', content: u.prompt }],
  } }));
  // OpenRouter requires endpoint, model and provider to be serialised before requests.
  const body = JSON.stringify({ endpoint: '/v1/messages', model: cfg.model, provider: { only: ['anthropic'] }, requests });
  const r = await fetch(`${OR}/batches`, { method: 'POST', headers: H, body });
  const j = await r.json();
  if (!r.ok) throw new Error(`submit ${r.status}: ${JSON.stringify(j).slice(0, 400)}`);
  jobs[name] = { id: j.id, label, name, model: cfg.model, think: THINK[label], submitted_at: new Date().toISOString(), requests: units.length, est_usd: est, status: j.status };
  saveJobs();
  console.log(`${name}: submitted ${j.id} (${j.status})`);
}

// Haiku 4.5 has a `:batch` price row but OpenRouter's Batch API refuses it ("does not have a :batch endpoint",
// 2026-10-07), so it runs realtime on chat/completions, pinned to Anthropic. Billed usage.cost is the realtime
// price; the arm file also carries the Batch-equivalent (× 0.5, the listed :batch rate).
async function realtime(label, name, cfg, units) {
  const conc = Number(opt('conc', 2));
  const out = path.join(W, 'arms', `${name}.jsonl`);
  const date = new Date().toISOString().slice(0, 10);
  let billed = 0, n = 0, inT = 0, outT = 0; const errs = [];
  const q = [...units];
  await Promise.all(Array.from({ length: conc }, async () => {
    for (let u = q.shift(); u; u = q.shift()) {
      if (spent() + billed > CAP) { errs.push('CAP'); q.length = 0; return; }
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        try {
          const r = await fetch(`${OR}/chat/completions`, { method: 'POST', headers: H, body: JSON.stringify({
            model: cfg.model, max_tokens: u.max_out + THINK_HEADROOM[label], usage: { include: true },
            provider: { order: ['anthropic'], allow_fallbacks: false }, messages: [{ role: 'user', content: u.prompt }] }) });
          const j = await r.json();
          if (!r.ok || j.error) throw new Error(`${r.status} ${JSON.stringify(j.error || j).slice(0, 160)}`);
          const ch = j.choices?.[0] || {}, us = j.usage || {};
          const c = typeof us.cost === 'number' ? us.cost : (us.prompt_tokens * cfg.rt_in + us.completion_tokens * cfg.rt_out) / 1e6;
          billed += c; inT += us.prompt_tokens || 0; outT += us.completion_tokens || 0;
          const raw = (ch.message?.content || '').trim();
          if (!raw) throw new Error(`empty (${ch.native_finish_reason || ch.finish_reason})`);
          fs.appendFileSync(out, JSON.stringify({ uid: u.uid, arm: label, model: j.model || cfg.model, or_slug: cfg.model, text: sanitizeTranslationTags(raw), finish: ch.native_finish_reason || ch.finish_reason,
            in: us.prompt_tokens, out: us.completion_tokens, thinking: us.completion_tokens_details?.reasoning_tokens || 0, usd_realtime: c, usd_batch: c * 0.5, date, config: {}, route: `openrouter-realtime:${j.provider}` }) + '\n');
          n++; ok = true;
        } catch (e) { if (attempt === 2) errs.push(`${u.uid}: ${e.message}`); else await sleep(4000 * (attempt + 1)); }
      }
    }
  }));
  fs.appendFileSync(LEDGER, JSON.stringify({ arm: name, model: cfg.model, mode: 'realtime', n: units.length, written: n, failed: units.length - n, in: inT, out: outT, billed_usd: billed, usd: billed, at: new Date().toISOString() }) + '\n');
  console.log(`${name}: realtime ${n}/${units.length} written; ${errs.length} errors${errs.length ? ` (${errs.slice(0, 3).join(' | ')})` : ''}; in ${inT} out ${outT}; billed $${billed.toFixed(4)} → $${(billed / Math.max(1, n) * 1000).toFixed(2)}/1K realtime, $${(billed / Math.max(1, n) * 500).toFixed(2)}/1K Batch-equivalent`);
}

function textOf(body) {
  const blocks = body?.content || [];
  return blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

async function collect(pollMin) {
  const t0 = Date.now();
  for (;;) {
    const open = Object.values(jobs).filter((j) => !j.collected);
    if (!open.length) { console.log('no open jobs'); return; }
    for (const job of open) {
      const r = await fetch(`${OR}/batches/${job.id}`, { headers: H });
      const b = await r.json();
      if (!r.ok) { console.log(`${job.name}: poll ${r.status} ${JSON.stringify(b).slice(0, 200)}`); continue; }
      if (!['completed', 'failed', 'expired', 'cancelled'].includes(b.status)) { console.log(`${job.name}: ${b.status} ${JSON.stringify(b.request_counts || {})}`); continue; }
      fs.writeFileSync(path.join(W, `batch-${job.name}-${job.id}.json`), JSON.stringify(b));
      const cfg = ARMS[job.label];
      const date = new Date().toISOString().slice(0, 10);
      const out = path.join(W, 'arms', `${job.name}.jsonl`);
      let n = 0, fail = 0, inT = 0, outT = 0, listUsd = 0;
      const errs = [];
      for (const it of b.results || []) {
        const body = it.response?.body;
        if (!body || it.error || (it.response.status_code && it.response.status_code !== 200)) { fail++; errs.push(JSON.stringify(it.error || body?.error || it.response).slice(0, 160)); continue; }
        const u = body.usage || {};
        const tin = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), tout = u.output_tokens || 0;
        const c = tin * cfg.in / 1e6 + tout * cfg.out / 1e6;
        inT += tin; outT += tout; listUsd += c;
        const raw = textOf(body).trim();
        if (!raw) { fail++; errs.push(`empty ${it.custom_id} (${body.stop_reason})`); continue; }
        n++;
        const thinking = (body.content || []).filter((x) => x.type === 'thinking').map((x) => x.thinking || '').join('').length;
        fs.appendFileSync(out, JSON.stringify({ uid: it.custom_id, arm: job.label, model: body.model || cfg.model, or_slug: cfg.model, text: sanitizeTranslationTags(raw), finish: body.stop_reason,
          in: tin, out: tout, thinking_chars: thinking, usd_batch: c, job: job.id, date, config: job.think, route: 'openrouter-batch:anthropic' }) + '\n');
      }
      const billed = typeof b.usage?.cost === 'number' ? b.usage.cost : null;
      fs.appendFileSync(LEDGER, JSON.stringify({ arm: job.name, model: cfg.model, n: (b.results || []).length, written: n, failed: fail, in: inT, out: outT, list_usd: listUsd, billed_usd: billed, usd: billed ?? listUsd, usage: b.usage, job: job.id, status: b.status, at: new Date().toISOString() }) + '\n');
      Object.assign(job, { collected: b.status, written: n, failed: fail, billed_usd: billed, list_usd: listUsd }); saveJobs();
      console.log(`${job.name}: ${b.status}; ${n} written, ${fail} failed${errs.length ? ` (${[...new Set(errs)].slice(0, 3).join(' | ')})` : ''}; in ${inT} out ${outT}; billed $${billed?.toFixed(4)} list $${listUsd.toFixed(4)} → $${((billed ?? listUsd) / Math.max(1, n) * 1000).toFixed(2)}/1K pages`);
    }
    if (Date.now() - t0 > pollMin * 60000) return;
    await sleep(30000);
  }
}

if (opt('arm')) await submit(opt('arm'), opt('sets', 'tib-ref58,tib-ref113,xl').split(','), opt('uids'), opt('tag', ''));
if (args.includes('--collect')) await collect(Number(opt('poll-minutes', 9)));
console.log(`ledger $${spent().toFixed(4)}; pending (est) $${pending().toFixed(4)}`);
