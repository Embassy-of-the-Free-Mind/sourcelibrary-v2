#!/usr/bin/env node
// PRIOR ART: translation-vs-reference/score.mjs writes one results.json per packet (arms, strata, pairs within ONE
// reference); scripts/eval/xlref-t1/report.mjs rolls T1's passes into rows and a summary. Neither joins two packets
// that swap the reference, which is what a human-vs-human ceiling needs. This joins score.mjs's two outputs by page.
/** Human ceiling (#5762): join the reference-A and reference-B results by page; human-vs-human fidelity, the machine arms against both translators, share of the ceiling reached, the judge's noise floor. */
/**
 *   node scripts/eval/translation-vs-reference/human-ceiling/report.mjs --ref-a <results-refA.json> --ref-b <results-refB.json> \
 *        --pairs <pairs.json> --out <dir> [--retest T1=<results.json>:flash-0:prod-A,T2=<results.json>:flash:lite-a] [--seed 5762]
 * Writes <dir>/summary.json, rows.jsonl (page × reference × arm) and table.md. The page is the unit (one page per
 * book); each page's score is the mean over the two judges and, for the headline, over the two references.
 * Share of the ceiling = (arm − 1) / (human − 1): 1 is the scale's floor ("not this page's text"), 5 its top.
 */
import fs from 'node:fs';
import path from 'node:path';
import { resetSeed, bootstrapCI, bootstrapRatioCI, mean } from '../../lib/paired-stats.mjs';
import { writeJsonl } from '../common.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const OUT = opt('out'); const SEED = Number(opt('seed', 5762));
if (!opt('ref-a') || !opt('ref-b') || !opt('pairs') || !OUT) { console.error('--ref-a, --ref-b, --pairs and --out are required'); process.exit(1); }
const RA = JSON.parse(fs.readFileSync(opt('ref-a'), 'utf8')), RB = JSON.parse(fs.readFileSync(opt('ref-b'), 'utf8'));
const pairs = Object.fromEntries(JSON.parse(fs.readFileSync(opt('pairs'), 'utf8')).map((p) => [p.id, p]));
const ARMS = ['human', 'flash', 'lite', 'self'];
const LANG = { T1: 'Latin', T2: 'Greek' };
const r3 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);
const stat = (xs) => { const v = xs.filter((x) => x != null); return { mean: r3(mean(v)), ci: v.length > 1 ? bootstrapCI(v).map(r3) : null, n: v.length }; };

const pa = Object.fromEntries(RA.per_page.map((p) => [p.id, p])), pb = Object.fromEntries(RB.per_page.map((p) => [p.id, p]));
const ids = Object.keys(pa).filter((id) => pb[id] && pairs[id]);
const judgeCells = (p, arm) => Object.values(p.arms[arm]?.by_judge || {}).filter(Boolean);
const flag = (p, arm, f) => { const c = judgeCells(p, arm); return c.length ? mean(c.map((z) => (f(z) ? 1 : 0))) : null; };
const page = ids.map((id) => {
  const o = { id, lang: LANG[pairs[id].track] || pairs[id].lang, independent: pairs[id].independent, canonical: pairs[id].canonical, a_style: pairs[id].a.style, b_style: pairs[id].b.style,
    fit_usable: ![...Object.values(pa[id].reference_fit), ...Object.values(pb[id].reference_fit)].includes('wrong'),
    human_span_same: [...judgeCells(pa[id], 'human'), ...judgeCells(pb[id], 'human')].every((z) => z.span === 'same') };
  for (const arm of ARMS) {
    const a = pa[id].arms[arm]?.fidelity ?? null, b = pb[id].arms[arm]?.fidelity ?? null;
    o[arm] = { vs_a: a, vs_b: b, both: a != null && b != null ? (a + b) / 2 : null,
      omission: mean([flag(pa[id], arm, (z) => z.omission), flag(pb[id], arm, (z) => z.omission)].filter((x) => x != null)),
      reversal: mean([flag(pa[id], arm, (z) => z.reversal), flag(pb[id], arm, (z) => z.reversal)].filter((x) => x != null)) };
  }
  return o;
});

function block(ps) {
  const out = { pages: ps.length };
  for (const arm of ARMS) out[arm] = { vs_a: stat(ps.map((p) => p[arm].vs_a)), vs_b: stat(ps.map((p) => p[arm].vs_b)), both: stat(ps.map((p) => p[arm].both)),
    pages_le3: r3(mean(ps.filter((p) => p[arm].both != null).map((p) => (p[arm].both <= 3 ? 1 : 0)))), omission: stat(ps.map((p) => p[arm].omission)), reversal: stat(ps.map((p) => p[arm].reversal)) };
  const ok = ps.filter((p) => p.human.both != null && p.flash.both != null && p.lite.both != null);
  const d = (x, y) => stat(ok.map((p) => p[x].both - p[y].both));
  const share = (x) => { const b = bootstrapRatioCI(ok.map((p) => p[x].both - 1), ok.map((p) => p.human.both - 1)); return { share: r3(b.rate), ci: b.ci ? b.ci.map(r3) : null, n: ok.length }; };
  out.delta = { flash_minus_human: d('flash', 'human'), lite_minus_human: d('lite', 'human'), flash_minus_lite: d('flash', 'lite'), human_vs_a_minus_vs_b: stat(ok.map((p) => p.human.vs_a - p.human.vs_b)) };
  out.share_of_ceiling = { flash: share('flash'), lite: share('lite') };
  out.pages_machine_at_or_above_human = { flash: r3(mean(ok.map((p) => (p.flash.both >= p.human.both ? 1 : 0)))), lite: r3(mean(ok.map((p) => (p.lite.both >= p.human.both ? 1 : 0)))) };
  return out;
}
resetSeed(SEED);
const groups = { all: page, Greek: page.filter((p) => p.lang === 'Greek'), Latin: page.filter((p) => p.lang === 'Latin') };
for (const l of ['Greek', 'Latin']) {
  const g = groups[l];
  groups[`${l} · independent B only`] = g.filter((p) => p.independent === true);
  groups[`${l} · human cut judged same span`] = g.filter((p) => p.human_span_same);
  groups[`${l} · non-canonical`] = g.filter((p) => !p.canonical);
  groups[`${l} · A and B both 19th–20th c.`] = g.filter((p) => p.a_style !== 'early-modern' && p.b_style !== 'early-modern');
  groups[`${l} · A or B early-modern`] = g.filter((p) => p.a_style === 'early-modern' || p.b_style === 'early-modern');
}
const summary = { generated: new Date().toISOString(), seed: SEED, measure: 'judged against a human reference (two blind Opus judges); the ceiling is one published translator judged against another',
  share_definition: '(arm − 1) / (human − 1) on mean fidelity over both references, bootstrap over pages',
  gate: { ref_a: RA.gate.pass, ref_b: RB.gate.pass }, agreement: { ref_a: RA.agreement, ref_b: RB.agreement }, reference_fit: { ref_a: RA.reference_fit, ref_b: RB.reference_fit },
  groups: Object.fromEntries(Object.entries(groups).filter(([, g]) => g.length >= 5).map(([k, g]) => [k, block(g)])) };

// ── the judge's retest noise: the same arm on the same page against the same reference A, judged in T1/T2 and again here
if (opt('retest')) {
  summary.retest = {};
  for (const spec of opt('retest').split(',')) {
    const [track, rest] = spec.split('='); const [file, flashArm, liteArm] = rest.split(':');
    const old = Object.fromEntries(JSON.parse(fs.readFileSync(file, 'utf8')).per_page.map((p) => [p.id, p]));
    const d = [];
    for (const p of page) for (const [arm, oldArm] of [['flash', flashArm], ['lite', liteArm]]) {
      if (pairs[p.id].track !== track || pairs[p.id].arms[arm].from_arm !== oldArm) continue;
      const was = old[p.id]?.arms?.[oldArm]?.fidelity, now = p[arm].vs_a;
      if (was != null && now != null) d.push(now - was);
    }
    summary.retest[track] = { cells: d.length, mean_shift: r3(mean(d)), ci: d.length > 1 ? bootstrapCI(d).map(r3) : null, mean_abs_diff: r3(mean(d.map(Math.abs))), exact: r3(mean(d.map((x) => (x === 0 ? 1 : 0)))), within_half: r3(mean(d.map((x) => (Math.abs(x) <= 0.5 ? 1 : 0)))), from: path.basename(path.dirname(file)) + '/' + path.basename(file) };
  }
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
writeJsonl(path.join(OUT, 'rows.jsonl'), page.flatMap((p) => ARMS.flatMap((arm) => [['A', 'vs_a'], ['B', 'vs_b']].map(([ref, k]) => ({ id: p.id, lang: p.lang, book_id: pairs[p.id].book_id, page_number: pairs[p.id].page_number,
  reference: ref, reference_translator: pairs[p.id][ref.toLowerCase()].translator, reference_year: pairs[p.id][ref.toLowerCase()].year, reference_licence: pairs[p.id][ref.toLowerCase()].licence,
  arm, arm_is: arm === 'human' ? `translator ${ref === 'A' ? 'B' : 'A'}` : arm === 'self' ? `translator ${ref} (the reference itself)` : pairs[p.id].arms[arm].model, fidelity: p[arm][k], independent: p.independent, canonical: p.canonical })))));
const f = (s) => (s?.mean == null ? '–' : `${s.mean.toFixed(2)} [${s.ci ? s.ci.map((x) => x.toFixed(2)).join('–') : '–'}]`);
const sh = (s) => (s?.share == null ? '–' : `${Math.round(s.share * 100)}% [${s.ci ? s.ci.map((x) => Math.round(x * 100)).join('–') : '–'}]`);
const md = ['| group | pages | human vs human | B vs A | A vs B | Flash (vs A / vs B) | Lite (vs A / vs B) | reference vs itself | Flash − human | Lite − human | Flash share of ceiling | Lite share of ceiling |', '|---|---|---|---|---|---|---|---|---|---|---|---|'];
for (const [k, g] of Object.entries(summary.groups)) md.push(`| ${k} | ${g.pages} | **${f(g.human.both)}** | ${f(g.human.vs_a)} | ${f(g.human.vs_b)} | ${f(g.flash.both)} (${g.flash.vs_a.mean?.toFixed(2)} / ${g.flash.vs_b.mean?.toFixed(2)}) | ${f(g.lite.both)} (${g.lite.vs_a.mean?.toFixed(2)} / ${g.lite.vs_b.mean?.toFixed(2)}) | ${f(g.self.both)} | ${f(g.delta.flash_minus_human)} | ${f(g.delta.lite_minus_human)} | ${sh(g.share_of_ceiling.flash)} | ${sh(g.share_of_ceiling.lite)} |`);
fs.writeFileSync(path.join(OUT, 'table.md'), md.join('\n') + '\n');
console.log(md.join('\n'));
if (summary.retest) console.log(JSON.stringify(summary.retest));
