#!/usr/bin/env node
// PRIOR ART: scripts/eval/results/xlref-synthesis-2026-10/build.mjs recomputes Flash − Lite per language from each #5695 track's
// per-page rows, with no decision rule; scripts/eval/decision-cards-audit.mjs applies the routing card to those stored summaries,
// track by track, with one stake per track. Neither pools a second run with the first per language, nor issues the registered
// keeps / reverses / still-insufficient verdict. This does, reading rule.json and calling cardVerdict unchanged. $0: no model, no database.
//
// Usage: node scripts/eval/ref-topup-5873/analyze.mjs   (writes results/ref-topup-5873-2026-10/summary.json and verdicts.md)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrapCI, mean, resetSeed } from '../lib/paired-stats.mjs';
import { cardVerdict, effectBeyondFloor, heterogeneity, stakeTier } from '../lib/routing-rules.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RES = path.join(HERE, '..', 'results'), OUT = path.join(RES, 'ref-topup-5873-2026-10');
const RULE = JSON.parse(fs.readFileSync(path.join(HERE, 'rule.json'), 'utf8'));
const jl = (f) => fs.readFileSync(path.join(RES, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
const eitherJudge = (bj, k) => Object.values(bj || {}).some((j) => (Array.isArray(j?.[k]) ? j[k].length > 0 : !!j?.[k]));

// ── pages: one row per page with the four arms' two-judge fidelity ──────────────────────────────────────────
const pages = new Map();
const put = (id, base, arm, v) => { const p = pages.get(id) || { id, ...base, arms: {} }; p.arms[arm] = v; pages.set(id, p); };
const T4 = { 'prod-A': 'lite', 'prod-B': 'lite2', 'flash-0': 'flash', served: 'served' };
for (const r of jl('xlref-t4-2026-10/pages.jsonl')) if (r.packet === 1 && T4[r.arm] && r.fidelity != null) put(r.id, { lang: r.lang, pool: 'HAP', run: 'first', private: r.publishable === false, hidden: false }, T4[r.arm], { fidelity: r.fidelity, reversal: eitherJudge(r.by_judge, 'reversal'), omission: eitherJudge(r.by_judge, 'omission') });
for (const r of jl('xlref-t5-2026-10/pages.jsonl')) if (['lite', 'lite2', 'flash', 'served'].includes(r.arm) && r.fidelity != null) put(r.id, { lang: r.lang, pool: 'SPC', run: 'first', private: false, hidden: false }, r.arm, { fidelity: r.fidelity, reversal: eitherJudge(r.by_judge, 'reversal'), omission: eitherJudge(r.by_judge, 'omission') });
const top = JSON.parse(fs.readFileSync(path.join(OUT, 'results.json'), 'utf8'));
if (top.gate?.pass !== true) throw new Error('gate did not pass: no verdict is issued (rule.json guards.gate)');
const align = JSON.parse(fs.readFileSync(path.join(OUT, 'alignment.json'), 'utf8'));
const hiddenIds = new Set(Object.entries(align).filter(([k]) => k.endsWith('-hidden')).flatMap(([, v]) => v.filter((b) => b.outcome === 'used').map((b) => b.book_id)));
const dropped = [];
for (const p of top.per_page) {
  const fits = Object.values(p.reference_fit || {});
  if (fits.length >= 2 && fits.every((f) => f === 'wrong')) { dropped.push({ id: p.id, why: 'both judges call the reference cut wrong' }); continue; }
  for (const [arm, a] of Object.entries(p.arms)) if (['lite', 'lite2', 'flash', 'served'].includes(arm) && a.fidelity != null) put(p.id, { lang: p.lang, pool: RULE.pools.HAP.languages.includes(p.lang) ? 'HAP' : 'SPC', run: 'topup', private: !!p.private, canonical: !!p.canonical, hidden: hiddenIds.has(p.book_id) }, arm, { fidelity: a.fidelity, reversal: eitherJudge(a.by_judge, 'reversal'), omission: eitherJudge(a.by_judge, 'omission') });
}
const all = [...pages.values()];

// ── statistics ──────────────────────────────────────────────────────────────────────────────────────────────
resetSeed(RULE.ci.seed);
const stat = (xs) => (xs.length ? { n: xs.length, delta: r2(mean(xs)), ci: xs.length > 1 ? bootstrapCI(xs, RULE.ci.iters).map(r2) : null } : { n: 0, delta: null, ci: null });
const paired = (rows, a, b) => stat(rows.filter((p) => p.arms[a] && p.arms[b]).map((p) => p.arms[a].fidelity - p.arms[b].fidelity));
const level = (rows, arm) => { const s = stat(rows.filter((p) => p.arms[arm]).map((p) => p.arms[arm].fidelity)); return { n: s.n, mean: s.delta, ci: s.ci }; };
const rate = (rows, arm, k) => { const v = rows.filter((p) => p.arms[arm]); return v.length ? Math.round(1000 * v.filter((p) => p.arms[arm][k]).length / v.length) / 10 : null; };
const cell = (rows) => ({
  flash_minus_lite: paired(rows, 'flash', 'lite'), a_vs_a: paired(rows, 'lite2', 'lite'), flash_minus_lite2: paired(rows, 'flash', 'lite2'),
  served: level(rows.filter((p) => !p.hidden), 'served'), lite: level(rows, 'lite'), flash: level(rows, 'flash'),
  reversals_per_100: { lite: rate(rows, 'lite', 'reversal'), flash: rate(rows, 'flash', 'reversal') }, omission_pct: { lite: rate(rows, 'lite', 'omission'), flash: rate(rows, 'flash', 'omission') },
});

const JUDGE = { controls_pass: true, ties_allowed: true, blind_judges: 2, human_calibrated: false, absolute_threshold: false, same_family_as_candidate: false };
const summary = { rule: RULE.id, generated: new Date().toISOString().slice(0, 10), measure: 'judged_vs_reference', gate: top.gate, agreement: top.agreement, dropped, pools: {}, languages: {}, sensitivity: {} };
for (const [poolName, def] of Object.entries(RULE.pools)) {
  const rows = all.filter((p) => p.pool === poolName), fresh = rows.filter((p) => p.run === 'topup');
  const c = cell(rows), cf = cell(fresh), cfirst = cell(rows.filter((p) => p.run === 'first'));
  const floor = c.a_vs_a, pool = { name: poolName, ...c.flash_minus_lite, registered: true };
  const langs = def.languages.map((lang) => ({ lang, ...cell(rows.filter((p) => p.lang === lang)).flash_minus_lite })).filter((l) => l.n > 0);
  const het = heterogeneity(langs, pool);
  const poolEffect = effectBeyondFloor(pool, floor, { min_effect: RULE.min_effect });
  // Does the top-up pass alone (a replication of the pool, if it has >= 30 fresh books)?
  const freshAlone = effectBeyondFloor(cf.flash_minus_lite, cf.a_vs_a, { min_effect: RULE.min_effect });
  const replication = cf.flash_minus_lite.n >= 30 ? { fresh_books: cf.flash_minus_lite.n, passed_alone: freshAlone.pass === true, pooled_registered: true } : null;
  summary.pools[poolName] = { combined: c, first_run: cfirst, topup: cf, heterogeneity: het, effect_test: poolEffect, topup_alone_effect_test: freshAlone, topup_is_a_replication: replication ? replication.passed_alone : `no: ${cf.flash_minus_lite.n} fresh books (< 30)` };

  for (const lang of def.languages) {
    const lr = rows.filter((p) => p.lang === lang); if (!lr.length) continue;
    const comb = cell(lr), fr = cell(lr.filter((p) => p.run === 'topup')), first = cell(lr.filter((p) => p.run === 'first'));
    const e = comb.flash_minus_lite, target = RULE.targets[lang];
    const evidence = (n) => ({ proposes_change: true, measure: 'judged_vs_reference', metric: 'fidelity', stake: { usd: RULE.stake_usd[lang] ?? 0, reversible: true }, preregistered: true, floor,
      languages: langs.map((l) => (l.lang === lang ? { ...l, n } : l)), pool, judge: JUDGE, replication });
    const card = cardVerdict('routing', evidence(e.n)), line = card.languages[lang];
    const own = effectBeyondFloor(e, floor, { min_effect: RULE.min_effect });
    const g1 = !(fr.flash_minus_lite.n >= 10 && fr.flash_minus_lite.delta <= 0);
    const nOk = e.n >= 30;
    let verdict, why = [];
    if (!target) { verdict = 'reported, not decided'; why.push(`${e.n} books; not a top-up language`); }
    else if (nOk && line.cleared && g1) verdict = 'keeps';
    else if (nOk && e.ci && (e.ci[1] < RULE.min_effect || e.delta <= 0)) { verdict = 'reverses'; why.push(e.delta <= 0 ? 'point estimate ≤ 0' : `upper bound ${e.ci[1]} under ${RULE.min_effect}`); }
    else { verdict = 'still insufficient'; if (!nOk) why.push(`n ${e.n}: short of 30 by ${30 - e.n}`); if (nOk && !line.cleared) why.push('effect neither shown nor excluded'); if (!g1) why.push('G1: the top-up pages alone show no effect'); }
    // What the tier still owes beyond the per-language line (never waived by a "keeps").
    const owes = card.missing.filter((m) => !m.startsWith('per-language evidence'));
    // The census reading, for a language whose every book has been tried and which is still under 30.
    let census = null;
    if (target && !nOk) { const cv = cardVerdict('routing', evidence(30)); census = { note: 'if the cell is read as a census (every book in the library tried), treated as directional', line_cleared: cv.languages[lang].cleared, would_be: cv.languages[lang].cleared && g1 ? 'keeps' : 'still insufficient', tier_still_owes: cv.missing.filter((m) => !m.startsWith('per-language evidence')) }; }
    summary.languages[lang] = { pool: poolName, tier: target ? stakeTier({ usd: RULE.stake_usd[lang], reversible: true }) : null, stake_usd: RULE.stake_usd[lang] ?? null,
      n: { first_run: first.flash_minus_lite.n, topup: fr.flash_minus_lite.n, combined: e.n, served_combined: comb.served.n },
      served: comb.served, served_topup: fr.served, flash_minus_lite: e, flash_minus_lite_topup_only: fr.flash_minus_lite, flash_minus_lite_first_run: first.flash_minus_lite,
      a_vs_a: comb.a_vs_a, pool_floor: floor, own_effect_test: own, card_line: line, guard_G1_holds: g1, verdict, why, tier_still_owes: owes, census,
      reversals_per_100: comb.reversals_per_100, omission_pct: comb.omission_pct };
    const open = lr.filter((p) => !p.private);
    summary.sensitivity[lang] = { without_private_references: cell(open).flash_minus_lite, topup_canonical: cell(lr.filter((p) => p.run === 'topup' && p.canonical)).flash_minus_lite, topup_non_canonical: cell(lr.filter((p) => p.run === 'topup' && !p.canonical)).flash_minus_lite };
  }
}
summary.topup_all = cell(all.filter((p) => p.run === 'topup'));
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1) + '\n');

const ci = (c) => (c ? `[${c[0].toFixed(2)}, ${c[1].toFixed(2)}]` : '');
const sg = (x) => (x == null ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(2)}`);
const md = ['# Reference top-up (#5873): verdict per language', '', `Rule \`${RULE.id}\`, registered before the draw. Fidelity 1–5, two blind Opus judges; Flash − Lite paired by page; bootstrap 95 % (seed ${RULE.ci.seed}).`, '',
  '| language | tier | n (first + top-up) | served fidelity [95 %] | Flash − Lite [95 %] | top-up pages alone | A-vs-A floor (pool) | verdict |', '|---|---|---|---|---|---|---|---|'];
for (const [lang, L] of Object.entries(summary.languages)) md.push(`| ${lang} | ${L.tier ?? '—'} | ${L.n.combined} (${L.n.first_run} + ${L.n.topup}) | ${L.served.mean?.toFixed(2)} ${ci(L.served.ci)} (n ${L.served.n}) | ${sg(L.flash_minus_lite.delta)} ${ci(L.flash_minus_lite.ci)} | ${sg(L.flash_minus_lite_topup_only.delta)} ${ci(L.flash_minus_lite_topup_only.ci)} (n ${L.flash_minus_lite_topup_only.n}) | ${sg(L.pool_floor.delta)} ${ci(L.pool_floor.ci)} | **${L.verdict}**${L.why.length ? `: ${L.why.join('; ')}` : ''} |`);
md.push('', '| pool | n | Flash − Lite [95 %] | A-vs-A | heterogeneity | top-up alone | top-up is a replication? |', '|---|---|---|---|---|---|---|');
for (const [k, v] of Object.entries(summary.pools)) md.push(`| ${k} | ${v.combined.flash_minus_lite.n} | ${sg(v.combined.flash_minus_lite.delta)} ${ci(v.combined.flash_minus_lite.ci)} | ${sg(v.combined.a_vs_a.delta)} ${ci(v.combined.a_vs_a.ci)} | ${v.heterogeneity.pass ? 'passes' : `fails (${v.heterogeneity.offenders.join(', ')})`} | ${sg(v.topup.flash_minus_lite.delta)} ${ci(v.topup.flash_minus_lite.ci)} (n ${v.topup.flash_minus_lite.n}) | ${v.topup_is_a_replication === true ? 'yes: it passes the effect test alone' : v.topup_is_a_replication === false ? 'no: it does not pass alone' : v.topup_is_a_replication} |`);
md.push('', '## What each tier still owes', '');
for (const [lang, L] of Object.entries(summary.languages)) if (L.tier) md.push(`- **${lang}** (${L.tier}, ≈ $${L.stake_usd}): ${[...(L.verdict === 'keeps' ? [] : L.why), ...L.tier_still_owes].join('; ') || 'nothing'}${L.census ? `. Read as a census: ${L.census.would_be}${L.census.tier_still_owes.length ? ` (still owes: ${L.census.tier_still_owes.join('; ')})` : ''}` : ''}`);
fs.writeFileSync(path.join(OUT, 'verdicts.md'), md.join('\n') + '\n');
console.log(md.join('\n'));
