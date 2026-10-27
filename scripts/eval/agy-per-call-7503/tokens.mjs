#!/usr/bin/env node
// PRIOR ART: scripts/eval/estimator/ocr/meter_quota_share.py — meters a lane's share of the agy pool from agy-calls.jsonl
// by day, not one eval's per-arm, per-page token cost from its read metas; none other reads `call_usage` (#7504).
/**
 * #7503: tokens, calls and refusals per arm, from the reads themselves. A one-per-call arm (cli-translate.mjs) is read
 * from its metas (one call per attempt; `call_usage` is the last attempt's). A block arm (claude-translate.mjs) is read
 * from its calls.jsonl, every call it made: refused calls and pages re-read alone are paid for, so they count.
 *
 *   node scripts/eval/agy-per-call-7503/tokens.mjs --scratch=DIR [--arms=A1,A1b,B2,C4] > tokens.json
 *
 * Quota index = input + 6 x (output + thinking) per page, relative to A1. The 6x weight is an ASSUMPTION (Gemini's
 * list-price ratio of output to input), not a measured agy quota rate; the uncached variant counts input minus cache_read.
 */
import fs from 'node:fs';
import path from 'node:path';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const S = arg('scratch');
const ARMS = (arg('arms') || 'A1,A1b,B2,C4').split(',');
const W = 6;
const zero = () => ({ input: 0, output: 0, thinking: 0, cache_read: 0 });
const add = (t, u) => { for (const k of Object.keys(t)) t[k] += Number(u?.[k] || 0); };

const out = {};
for (const arm of ARMS) {
  const dir = path.join(S, arm);
  const metas = fs.readdirSync(dir).filter((f) => f.endsWith('.meta.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  const t = zero();
  let calls = 0, refused = 0, alone = 0, missingUsage = 0;
  const callPages = {};
  const callLog = path.join(dir, 'calls.jsonl');
  if (fs.existsSync(callLog)) {
    for (const c of fs.readFileSync(callLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l))) {
      calls++;
      if (c.cls) refused++;
      if (/-[23]$/.test(c.call_id)) alone++;
      if (!c.usage) missingUsage++;
      callPages[c.pages.length] = (callPages[c.pages.length] || 0) + 1;
      add(t, c.usage);
    }
  } else {
    for (const m of metas) {
      calls += m.attempts || 1;
      if ((m.attempts || 1) > 1) refused += m.attempts - 1;
      if (!m.call_usage) missingUsage++;
      callPages[1] = (callPages[1] || 0) + (m.attempts || 1);
      add(t, m.call_usage);
    }
  }
  const n = metas.length;
  const ok = metas.filter((m) => m.exit === 0).length;
  const secs = metas.map((m) => (Date.parse(m.finished_at) - Date.parse(m.started_at)) / 1000);
  const per = (x) => x / n;
  out[arm] = {
    pages: n, ok, calls, call_pages: callPages, refused_calls: refused, pages_reread_alone: alone, calls_without_usage: missingUsage,
    per_page: { input: per(t.input), cache_read: per(t.cache_read), uncached_input: per(t.input - t.cache_read), output: per(t.output), thinking: per(t.thinking) },
    quota_index: per(t.input + W * (t.output + t.thinking)),
    quota_index_uncached: per(t.input - t.cache_read + W * (t.output + t.thinking)),
    english_chars_per_page: per(metas.reduce((s, m) => s + (m.chars || 0), 0)),
    elapsed_secs: Number(fs.readFileSync(path.join(S, `${arm}.end`), 'utf8')) - Number(fs.readFileSync(path.join(S, `${arm}.start`), 'utf8')),
    call_secs_mean_per_page: secs.reduce((a, b) => a + b, 0) / n,
  };
}
const base = out[ARMS[0]];
for (const a of ARMS) { out[a].quota_rel_A1 = out[a].quota_index / base.quota_index; out[a].quota_rel_A1_uncached = out[a].quota_index_uncached / base.quota_index_uncached; }
console.log(JSON.stringify({ weight_output: W, weight_note: 'assumed, not measured', arms: out }, null, 1));
