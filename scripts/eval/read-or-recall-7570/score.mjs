#!/usr/bin/env node
// PRIOR ART: scripts/eval/continuation-probe-7271/score.mjs (control gates fixed before replies are read, percentile
// bootstrap with a seeded Mulberry32; its rng/quantile code is copied here because that file runs on import).
/**
 * score.mjs — score the three arms and the controls of #7570 and apply the preregistered gates and decision rule.
 *
 *   node scripts/eval/read-or-recall-7570/score.mjs
 *
 * Reads pairs.json, raw-opus.jsonl, raw-gemini.jsonl, controls.json. Writes scores.jsonl (no page text), report.json
 * and report.md. Every (page, engine, arm) is scored against the primary key (stored e-text window where the page has
 * one, else the blind Opus key) and, as the sensitivity, against the blind Opus key. Arm C is scored as anchor +
 * continuation. A failed call (any error class, or an empty text) scores 0 and is counted. A pair enters an engine's
 * numbers only when all six of its (page, arm) calls were made for that engine.
 *
 * Outcomes per script × engine (95% percentile bootstrap over pairs, 10,000 draws, seed 7570):
 *   R   = mean acc(C | famous) − mean acc(C | obscure)
 *   DiD = mean (acc(A) − acc(C) | obscure) − mean (acc(A) − acc(C) | famous)
 *   L   = mean (acc(A) − acc(B) | famous) − mean (acc(A) − acc(B) | obscure)
 * GATES (preregistered): P gate = mean recall_ng of the script's two positive controls ≥ 0.50; reading gate = median
 * acc(B | obscure) ≥ 0.50. Measurable gap = R or DiD with point ≥ 0.05 and CI lower bound > 0, for an engine passing both.
 * Full run justified if ≥ 2 scripts show a measurable gap for at least one engine.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { score } from './text.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RES = path.join(__dirname, '../results/read-or-recall-7570');
const sealed = JSON.parse(fs.readFileSync(path.join(RES, 'pairs.json'), 'utf8'));
const controls = JSON.parse(fs.readFileSync(path.join(RES, 'controls.json'), 'utf8')).items;
const ENGINES = ['opus', 'gemini'];
const SCRIPTS = ['latin', 'greek', 'chinese', 'hebrew', 'sanskrit'];
const raw = {};
for (const e of ENGINES) {
  const f = path.join(RES, `raw-${e}.jsonl`); raw[e] = new Map();
  if (fs.existsSync(f)) for (const l of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); if (r.cls === 'quota' || r.cls === 'usage_limit') continue; raw[e].set(`${r.slug}|${r.arm}`, r); }
}

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)))]; };
function boot(items, stat, B = 10000, seed = 7570) {
  if (!items.length) return [null, null];
  const r = rng(seed), out = [];
  for (let b = 0; b < B; b++) { const s = []; for (let i = 0; i < items.length; i++) s.push(items[Math.floor(r() * items.length)]); out.push(stat(s)); }
  return [q(out, 0.025), q(out, 0.975)];
}
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);

// ---- per page × engine × arm ------------------------------------------------------------------------------------------
const rows = [];
const S = {}; // S[engine][slug][arm] = { primary, opus }
for (const e of ENGINES) {
  S[e] = {};
  for (const p of sealed.pages) {
    S[e][p.slug] = {};
    S[e][p.slug].anchor = { primary: score(p.anchor, p.key_text, p.script), opus: score(p.anchor, p.opus_key_text, p.script) };
    for (const arm of ['A', 'B', 'C']) {
      const r = raw[e].get(`${p.slug}|${arm}`);
      if (!r) continue;
      const failed = !!r.cls || !String(r.text || '').trim();
      const out = failed ? '' : arm === 'C' ? `${p.anchor} ${r.text}` : r.text;
      const zero = (k) => { const s = score('', k, p.script); return s ? { ...s, acc: 0 } : null; };
      const sc = { primary: failed ? zero(p.key_text) : score(out, p.key_text, p.script), opus: failed ? zero(p.opus_key_text) : score(out, p.opus_key_text, p.script), failed, cls: r.cls || (failed ? 'empty' : null), problem: r.problem || null };
      S[e][p.slug][arm] = sc;
      rows.push({ slug: p.slug, pair_id: p.pair_id, script: p.script, side: p.side, engine: e, arm, key_kind: p.key_kind, failed, cls: sc.cls, problem: sc.problem,
        primary: sc.primary && { acc: r3(sc.primary.acc), recall_ng: r3(sc.primary.recall_ng), lcs: sc.primary.lcs, key_chars: sc.primary.key_chars, out_chars: sc.primary.out_chars },
        opus_key: sc.opus && { acc: r3(sc.opus.acc), recall_ng: r3(sc.opus.recall_ng), lcs: sc.opus.lcs } });
    }
  }
}
// controls
const ctl = {};
for (const e of ENGINES) for (const c of controls) {
  const r = raw[e].get(`${c.slug}|P`); if (!r) continue;
  const failed = !!r.cls || !String(r.text || '').trim();
  const s = score(failed ? '' : r.text, c.ref, c.script);
  (ctl[e] ||= {})[c.slug] = { script: c.script, failed, acc: r3(failed ? 0 : s.acc), recall_ng: r3(failed ? 0 : s.recall_ng), lcs: failed ? 0 : s.lcs };
}

// ---- aggregates ----------------------------------------------------------------------------------------------------------
const report = { issue: 7570, scored_at: new Date().toISOString(), keys: ['primary', 'opus'], per: {}, controls: ctl, flags: [], decision: {} };
const pagesBy = new Map(sealed.pages.map((p) => [p.slug, p]));
function aggregate(e, script, keyName, pairFilter = () => true) {
  const pairs = sealed.pairs.filter((x) => x.script === script).filter(pairFilter).map((x) => {
    const f = S[e][`${x.pair_id}-f`], o = S[e][`${x.pair_id}-o`];
    if (!f || !o || !['A', 'B', 'C'].every((a) => f[a] && o[a])) return null;
    const v = (side, a) => side[a][keyName]?.acc;
    const vals = { fA: v(f, 'A'), fB: v(f, 'B'), fC: v(f, 'C'), oA: v(o, 'A'), oB: v(o, 'B'), oC: v(o, 'C') };
    if (Object.values(vals).some((z) => z == null)) return null; // a key under the length floor: unjudgeable pair
    return { pair_id: x.pair_id, ...vals, fAnchor: f.anchor[keyName]?.acc ?? null, oAnchor: o.anchor[keyName]?.acc ?? null,
      fLcsC: f.C[keyName].lcs, oLcsC: o.C[keyName].lcs, fRngC: f.C[keyName].recall_ng, oRngC: o.C[keyName].recall_ng };
  }).filter(Boolean);
  const m = (k) => r3(mean(pairs.map((x) => x[k])));
  const R = (s) => mean(s.map((x) => x.fC)) - mean(s.map((x) => x.oC));
  const DiD = (s) => mean(s.map((x) => x.oA - x.oC)) - mean(s.map((x) => x.fA - x.fC));
  const L = (s) => mean(s.map((x) => x.fA - x.fB)) - mean(s.map((x) => x.oA - x.oB));
  const est = (f) => (pairs.length ? { point: r3(f(pairs)), ci: boot(pairs, f).map(r3) } : { point: null, ci: [null, null] });
  return { n_pairs: pairs.length, mean_acc: { famous: { A: m('fA'), B: m('fB'), C: m('fC'), anchor_only: m('fAnchor') }, obscure: { A: m('oA'), B: m('oB'), C: m('oC'), anchor_only: m('oAnchor') } },
    median_acc_B_obscure: r3(median(pairs.map((x) => x.oB))), median_lcs_C: { famous: median(pairs.map((x) => x.fLcsC)), obscure: median(pairs.map((x) => x.oLcsC)) },
    mean_recall_ng_C: { famous: m('fRngC'), obscure: m('oRngC') }, R: est(R), DiD: est(DiD), L: est(L) };
}
const measurable = (x) => x.point != null && x.point >= 0.05 && x.ci[0] != null && x.ci[0] > 0;
for (const e of ENGINES) for (const s of SCRIPTS) {
  const items = controls.filter((c) => c.script === s).map((c) => ctl[e]?.[c.slug]).filter(Boolean);
  const pGate = items.length === 2 ? mean(items.map((x) => x.recall_ng)) : null;
  const prim = aggregate(e, s, 'primary'), sens = aggregate(e, s, 'opus');
  const gates = { p_gate: pGate == null ? null : r3(pGate), p_pass: pGate != null && pGate >= 0.5, read_pass: prim.median_acc_B_obscure != null && prim.median_acc_B_obscure >= 0.5 };
  const gap = gates.p_pass && gates.read_pass && (measurable(prim.R) || measurable(prim.DiD));
  const entry = { gates, measurable_gap: gap, primary: prim, sensitivity_opus_key: sens };
  if (s === 'latin') {
    const kind = (k) => (x) => pagesBy.get(`${x.pair_id}-f`)?.famous_kind === k;
    entry.latin_split = { recitation_hit: aggregate(e, s, 'primary', kind('recitation-hit')), canonical_work: aggregate(e, s, 'primary', kind('canonical-work')) };
  }
  // label check: an obscure page the no-image arm reproduces is a suspect label
  for (const p of sealed.pages.filter((x) => x.script === s && x.side === 'obscure')) {
    const c = S[e][p.slug]?.C?.primary; if (c && c.acc >= 0.5) report.flags.push({ slug: p.slug, engine: e, acc_C: r3(c.acc), lcs: c.lcs, title: p.title });
  }
  (report.per[s] ||= {})[e] = entry;
}
// outcomes without the flagged pages' pairs
const flaggedPairs = new Set(report.flags.map((f) => f.slug.replace(/-o$/, '')));
for (const e of ENGINES) for (const s of SCRIPTS) report.per[s][e].without_flagged = flaggedPairs.size ? aggregate(e, s, 'primary', (x) => !flaggedPairs.has(x.pair_id)) : null;
// key check: blind Opus key vs the e-text window on famous Greek/Chinese pages
report.key_check = {};
for (const s of ['greek', 'chinese']) {
  const v = sealed.pages.filter((p) => p.script === s && p.key_kind === 'etext-window').map((p) => score(p.opus_key_text, p.key_text, p.script)).filter(Boolean);
  report.key_check[s] = { n: v.length, median_acc_opus_key_vs_etext: r3(median(v.map((x) => x.acc))), median_recall_ng: r3(median(v.map((x) => x.recall_ng))) };
}
for (const e of ENGINES) report.decision[e] = SCRIPTS.filter((s) => report.per[s][e].measurable_gap);
const maxScripts = Math.max(...ENGINES.map((e) => report.decision[e].length));
report.decision.full_run = maxScripts >= 2 ? 'justified' : maxScripts === 1 ? 'justified for that script family only' : 'not justified';
fs.writeFileSync(path.join(RES, 'scores.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(path.join(RES, 'report.json'), JSON.stringify(report, null, 1));

// ---- report.md ---------------------------------------------------------------------------------------------------------
const f2 = (x) => (x == null ? '–' : x.toFixed(2));
const ci = (x) => `${f2(x.point)} [${f2(x.ci[0])}, ${f2(x.ci[1])}]`;
let md = '| script | engine | pairs | P gate | read gate (med B obs) | famous A / B / C | obscure A / B / C | anchor only F / O | **R** (C: F − O) | **DiD** (gap O − F) | L (naming) | gap? |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n';
for (const s of SCRIPTS) for (const e of ENGINES) {
  const x = report.per[s][e], p = x.primary;
  md += `| ${s} | ${e} | ${p.n_pairs} | ${f2(x.gates.p_gate)} ${x.gates.p_pass ? '✓' : '✗'} | ${f2(p.median_acc_B_obscure)} ${x.gates.read_pass ? '✓' : '✗'} | ${f2(p.mean_acc.famous.A)} / ${f2(p.mean_acc.famous.B)} / ${f2(p.mean_acc.famous.C)} | ${f2(p.mean_acc.obscure.A)} / ${f2(p.mean_acc.obscure.B)} / ${f2(p.mean_acc.obscure.C)} | ${f2(p.mean_acc.famous.anchor_only)} / ${f2(p.mean_acc.obscure.anchor_only)} | ${ci(p.R)} | ${ci(p.DiD)} | ${ci(p.L)} | ${x.measurable_gap ? '**yes**' : 'no'} |\n`;
}
md += `\nSensitivity (every page against the blind Opus key):\n\n| script | engine | pairs | famous A / B / C | obscure A / B / C | R | DiD | L |\n|---|---|---|---|---|---|---|---|\n`;
for (const s of SCRIPTS) for (const e of ENGINES) { const p = report.per[s][e].sensitivity_opus_key; md += `| ${s} | ${e} | ${p.n_pairs} | ${f2(p.mean_acc.famous.A)} / ${f2(p.mean_acc.famous.B)} / ${f2(p.mean_acc.famous.C)} | ${f2(p.mean_acc.obscure.A)} / ${f2(p.mean_acc.obscure.B)} / ${f2(p.mean_acc.obscure.C)} | ${ci(p.R)} | ${ci(p.DiD)} | ${ci(p.L)} |\n`; }
md += `\nControls (no image; acc / recall_ng / lcs):\n\n| item | ${ENGINES.join(' | ')} |\n|---|${ENGINES.map(() => '---').join('|')}|\n`;
for (const c of controls) md += `| ${c.slug} | ${ENGINES.map((e) => { const z = ctl[e]?.[c.slug]; return z ? `${f2(z.acc)} / ${f2(z.recall_ng)} / ${z.lcs}` : '–'; }).join(' | ')} |\n`;
md += `\nLatin split (primary key): ${ENGINES.map((e) => { const z = report.per.latin[e].latin_split; return `${e}: recitation-hit n=${z.recitation_hit.n_pairs} R ${ci(z.recitation_hit.R)} DiD ${ci(z.recitation_hit.DiD)}; canonical n=${z.canonical_work.n_pairs} R ${ci(z.canonical_work.R)} DiD ${ci(z.canonical_work.DiD)}`; }).join(' · ')}\n`;
md += `\nKey check (blind Opus key vs e-text window, famous pages): ${JSON.stringify(report.key_check)}\n`;
md += `\nFlags (obscure page with acc(C) ≥ 0.50): ${report.flags.length ? report.flags.map((f) => `${f.slug} ${f.engine} ${f2(f.acc_C)} (${f.title.slice(0, 50)})`).join('; ') : 'none'}\n`;
md += `\nDecision: ${JSON.stringify(report.decision)}\n`;
fs.writeFileSync(path.join(RES, 'report.md'), md);
console.log(md);
