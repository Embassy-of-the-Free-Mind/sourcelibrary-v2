#!/usr/bin/env node
// PRIOR ART: scripts/eval/xlref-t5/analyze.py (T5's lever table: arm fidelity, paired Δ against the floor, reversals per
// 100 pages, $/page) — it reads one results.json of arms that were each translated. The cascade is not an arm anyone ran:
// it is a per-page choice between two judged arms, so its scores are composed here from score.mjs's per_page block.
/**
 *   node scripts/eval/zh-cascade-7202/analyze.mjs --work $JOB_SCRATCH/work --results <results.json> --out <summary.json>
 * Applies #7202's preregistered rule: base = the better of deepseek / qwen (two-judge mean fidelity, all pages; a tie goes
 * to the cheaper); cascade page = flash where the base fails a gate (gates.json), else the base; the cascade takes the
 * judged scores of the text it routed to. Reports every arm and the cascade against flash (paired Δ fidelity with a
 * bootstrap CI, seed 7202), reversals per 100 pages, routing (sample and reweighted to the cohort's flag share), cost per
 * Siku page and the 890K projection, and the rule's verdict.
 */
import fs from 'node:fs';
import path from 'node:path';
import { resetSeed, bootstrapCI, mean } from '../lib/paired-stats.mjs';
import { costOf, BATCH_MULTIPLIER } from '../../lib/model-pricing.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const W = opt('work'); const RES = opt('results'); const OUT = opt('out');
const FLAG_SHARE = 65011 / 992881; // #5600 cohort: Kanripo-flagged pages / screened pages (applied-books.jsonl, 2026-10-23)
const FLASH_BATCH = 0.00178;       // #7202's reference price: T5's Flash Batch $/page
const N_PAGES = 890000;
const ARMS = ['lite', 'lite2', 'flash', 'flash2', 'deepseek', 'qwen'];
const jl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const res = JSON.parse(fs.readFileSync(RES, 'utf8'));
const gates = JSON.parse(fs.readFileSync(path.join(W, 'gates.json'), 'utf8'));
const r3 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);
const pages = res.per_page.map((p) => ({ ...p, g: gates.per[p.id] }));
const judges = res.judges;
const revOf = (p, arm) => { const xs = judges.map((j) => p.arms[arm]?.by_judge?.[j]).filter(Boolean).map((z) => (z.reversal ? 1 : 0)); return xs.length ? mean(xs) : null; };
const omOf = (p, arm) => { const xs = judges.map((j) => p.arms[arm]?.by_judge?.[j]).filter(Boolean).map((z) => (z.omission ? 1 : 0)); return xs.length ? mean(xs) : null; };

// ── cost per page, measured, by arm (Siku pages and all pages) ─────────────────────────────────────────────────
const costRows = {};
for (const a of ARMS) costRows[a] = new Map(jl(path.join(W, 'arms', `${a}.jsonl`)).map((r) => [r.uid, r]));
const costOfRow = (a, r) => {
  if (!r) return null;
  if (a.startsWith('lite')) return r.usd_batch;
  if (a === 'deepseek' || a === 'qwen') return r.cost_reported ?? 0;
  // flash ran on agy ($0); its Batch-equivalent price is agy's own token counts at gemini-3.8-flash list × Batch
  return r.usage ? costOf('gemini-3.8-flash', r.usage.input_tokens || 0, (r.usage.output_tokens || 0) + (r.usage.thinking_tokens || 0)) * BATCH_MULTIPLIER : null;
};
const costPerPage = (a, ids) => { const xs = ids.map((id) => costOfRow(a, costRows[a].get(id))).filter((x) => x != null); return xs.length ? mean(xs) : null; };
// The OpenRouter total includes calls a provider cut and the resends (billed $0 when cut): charge everything to the arm.
const ledger = jl(path.join(W, 'ledger.jsonl'));
const spend = { lite_batch: ledger.filter((r) => r.mode === 'batch').reduce((s, r) => s + r.usd, 0), openrouter: ledger.filter((r) => r.mode === 'openrouter').reduce((s, r) => s + r.usd, 0) };

// ── which cheap arm is the base ─────────────────────────────────────────────────────────────────────────────────
const sikuIds = pages.filter((p) => p.track === 'siku').map((p) => p.id);
const fm = (a) => res.arms[a].fidelity.mean;
let base = fm('deepseek') > fm('qwen') ? 'deepseek' : fm('qwen') > fm('deepseek') ? 'qwen' : (costPerPage('deepseek', sikuIds) <= costPerPage('qwen', sikuIds) ? 'deepseek' : 'qwen');
const routedOf = (p) => (p.g.gates[base] || []).length > 0;
const cascadePick = (p) => (routedOf(p) ? 'flash' : base);

// ── per page values for every arm and the cascade ───────────────────────────────────────────────────────────────
const val = (p, arm) => (arm === 'cascade' ? val(p, cascadePick(p)) : { fid: p.arms[arm]?.fidelity ?? null, rev: revOf(p, arm), om: omOf(p, arm) });
resetSeed(7202);
const ALL = [...ARMS, 'cascade'];
const block = (ids) => {
  const sel = pages.filter((p) => ids.includes(p.id));
  const o = {};
  for (const a of ALL) {
    const fid = sel.map((p) => val(p, a).fid).filter((x) => x != null);
    const rev = sel.map((p) => val(p, a).rev).filter((x) => x != null);
    const om = sel.map((p) => val(p, a).om).filter((x) => x != null);
    const d = sel.map((p) => { const x = val(p, a).fid, y = val(p, 'flash').fid; return x != null && y != null ? x - y : null; }).filter((x) => x != null);
    const dr = sel.map((p) => { const x = val(p, a).rev, y = val(p, 'flash').rev; return x != null && y != null ? x - y : null; }).filter((x) => x != null);
    o[a] = { n: fid.length, fidelity: r3(mean(fid)), fidelity_ci: bootstrapCI(fid)?.map(r3), reversal_per100: r3(100 * mean(rev)), reversal_ci: bootstrapCI(rev)?.map((x) => r3(100 * x)), omission: r3(mean(om)),
      delta_vs_flash: r3(mean(d)), delta_vs_flash_ci: bootstrapCI(d)?.map(r3), reversal_delta_per100: r3(100 * mean(dr)), reversal_delta_ci: bootstrapCI(dr)?.map((x) => r3(100 * x)) };
  }
  return o;
};
const ids = (f) => pages.filter(f).map((p) => p.id);
const strata = { all: block(ids(() => true)), t5: block(ids((p) => p.track === 'T5-zh')), siku: block(sikuIds), siku_flagged: block(ids((p) => p.track === 'siku' && p.g.flagged)), siku_clean: block(ids((p) => p.track === 'siku' && !p.g.flagged)) };
const floors = { lite: res.pairs['lite:lite2']?.fidelity_delta, flash: res.pairs['flash:flash2']?.fidelity_delta };

// ── routing and cost ────────────────────────────────────────────────────────────────────────────────────────────
const rate = (f) => { const s = pages.filter(f); return s.length ? s.filter(routedOf).length / s.length : null; };
const routing = { all: r3(rate(() => true)), t5: r3(rate((p) => p.track === 'T5-zh')), siku: r3(rate((p) => p.track === 'siku')), siku_flagged: r3(rate((p) => p.track === 'siku' && p.g.flagged)), siku_clean: r3(rate((p) => p.track === 'siku' && !p.g.flagged)) };
routing.cohort_reweighted = r3(FLAG_SHARE * routing.siku_flagged + (1 - FLAG_SHARE) * routing.siku_clean);
const byGate = {};
for (const p of pages) for (const g of p.g.gates[base] || []) byGate[g] = (byGate[g] || 0) + 1;
// cost per Siku page, reweighted by stratum to the cohort's flag share
const wCost = (a) => { const f = costPerPage(a, ids((p) => p.track === 'siku' && p.g.flagged)), c = costPerPage(a, ids((p) => p.track === 'siku' && !p.g.flagged)); return f == null || c == null ? null : FLAG_SHARE * f + (1 - FLAG_SHARE) * c; };
const cost = Object.fromEntries(ARMS.map((a) => [a, wCost(a)]));
cost.cascade_paid = cost[base] + routing.cohort_reweighted * FLASH_BATCH;   // routed pages bought at Flash Batch
cost.cascade_agy = cost[base];                                              // routed pages read on agy instead ($0)
const projection = {
  flash_batch_reference: FLASH_BATCH * N_PAGES, flash_38_batch_measured: cost.flash != null ? cost.flash * N_PAGES : null, lite_batch: cost.lite * N_PAGES,
  deepseek: cost.deepseek * N_PAGES, qwen: cost.qwen * N_PAGES, cascade_paid: cost.cascade_paid * N_PAGES, cascade_agy: cost.cascade_agy * N_PAGES,
  cascade_agy_calls: Math.round(routing.cohort_reweighted * N_PAGES),
};

// ── the rule ────────────────────────────────────────────────────────────────────────────────────────────────────
const A = strata.all;
const matches = (a) => A[a].delta_vs_flash_ci && A[a].delta_vs_flash_ci[0] >= -0.15 && A[a].reversal_per100 <= A.flash.reversal_per100 + 3;
const rule = {
  cascade: { ci_lower: A.cascade.delta_vs_flash_ci?.[0], ci_ok: !!A.cascade.delta_vs_flash_ci && A.cascade.delta_vs_flash_ci[0] >= -0.15, reversal: A.cascade.reversal_per100, reversal_limit: r3(A.flash.reversal_per100 + 3),
    reversal_ok: A.cascade.reversal_per100 <= A.flash.reversal_per100 + 3, cost: cost.cascade_paid, cost_limit: 0.6 * FLASH_BATCH, cost_ok: cost.cascade_paid <= 0.6 * FLASH_BATCH },
};
rule.adopt_cascade = rule.cascade.ci_ok && rule.cascade.reversal_ok && rule.cascade.cost_ok;
rule.arms_matching_flash = ['lite', 'lite2', 'deepseek', 'qwen'].filter(matches).sort((a, b) => cost[a] - cost[b]);

// ── worst five pages per arm ───────────────────────────────────────────────────────────────────────────────────
const worst = Object.fromEntries(ALL.map((a) => [a, [...pages].filter((p) => val(p, a).fid != null).sort((x, y) => val(x, a).fid - val(y, a).fid).slice(0, 5).map((p) => {
  const arm = a === 'cascade' ? cascadePick(p) : a;
  const defects = judges.flatMap((j) => (p.arms[arm]?.by_judge?.[j]?.defects || []).filter((d) => d.severity === 'major').map((d) => `${d.class}: ${d.detail}`)).slice(0, 2);
  return { id: p.id, track: p.track, stratum: p.g.stratum, fidelity: val(p, a).fid, via: arm, gates: p.g.gates[base], url: `https://sourcelibrary.org/book/${p.book_id}?page=${p.page_number}`, defects };
})]));

const summary = { generated: new Date().toISOString(), base, gate: res.gate.pass, agreement: res.agreement, band: gates.band, routing, routed_by_gate: byGate, flag_share: FLAG_SHARE, strata, floors, cost, projection, spend, rule, worst };
fs.writeFileSync(OUT, JSON.stringify(summary, null, 1));
console.log(JSON.stringify({ base, routing, cost, rule, all: Object.fromEntries(ALL.map((a) => [a, { f: A[a].fidelity, ci: A[a].fidelity_ci, d: A[a].delta_vs_flash, dci: A[a].delta_vs_flash_ci, rev: A[a].reversal_per100 }])), floors, projection, spend }, null, 1));
