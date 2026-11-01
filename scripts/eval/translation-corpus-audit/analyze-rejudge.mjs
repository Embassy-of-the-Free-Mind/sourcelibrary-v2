#!/usr/bin/env node
// PRIOR ART: analyze-wave2.mjs (wave 2's analysis: estimate() below is its post-stratified estimator, copied unchanged
// because that script runs at top level and exports nothing; self-preference is its §4 form). It compares exactly two
// judges on one run dir. This re-judge (#5274, for #4916) puts two more Gemini judges on wave 2's items, whose verdicts
// live in a second dir, and asks of each: α vs Opus per measure, self-preference, and agreement with the 20 by-eye
// verdicts in wave 2's eye-notes.md. score.mjs --gate runs first, per judge; this reads its report-<judge>.json.
//
//   node scripts/eval/translation-corpus-audit/analyze-rejudge.mjs --wave2 scripts/eval/results/translation-corpus-audit-wave2-2026-10-30 \
//        --out scripts/eval/results/tca-gemini-rejudge-2026-11-01 \
//        --judges gemini-flash-low,gemini-3.8-flash,gemini-4-argon-medium --subset <out>/argon-subset-ids.txt
// Verdicts of a judge are read from <out>/verdicts/<judge> (or --run) when there, else from wave 2's dir.

import fs from 'node:fs';
import path from 'node:path';
import { resetSeed, seededRand } from '../lib/paired-stats.mjs';
import { judgeReliability, reliabilityLine, krippendorffAlpha } from '../lib/agreement-stats.mjs';
import { familyOf } from './arm.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const W2 = args.wave2, OUT = args.out, RUN = args.run || OUT, ITERS = 2000;
const JUDGES = String(args.judges).split(',');
const readJsonl = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : [];
const pct = (x) => x == null ? null : +(100 * x).toFixed(1);
const ge4 = (v) => v.fidelity >= 4, major = (v) => (v.defects || []).some((d) => d.severity === 'major');
const groupBy = (arr, f) => { const o = {}; for (const x of arr) (o[f(x)] ||= []).push(x); return o; };

// Wave 2's manifest; this run's images.json marks the 33 items judged on the corrected single-page image.
const imgs = fs.existsSync(path.join(OUT, 'images.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'images.json'), 'utf8')) : {};
const manifest = readJsonl(path.join(W2, 'manifest.jsonl')).map((m) => ({ ...m, spread_flag: !!imgs[m.id]?.spread_flag }));
const main = manifest.filter((m) => m.kind === 'main');
const log = JSON.parse(fs.readFileSync(path.join(W2, 'draw-log.json'), 'utf8'));
const armShares = JSON.parse(fs.readFileSync(path.join(W2, 'arm-shares.json'), 'utf8'));
const langW = Object.fromEntries(Object.entries(log.weights).map(([l, w]) => [l, w.translated_pages]));
const load = (dir, j) => {
  const V = {}, d = path.join(dir, 'verdicts', j);
  if (fs.existsSync(d)) for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.jsonl'))) for (const v of readJsonl(path.join(d, f))) if (v.id && typeof v.fidelity === 'number') V[v.id] = v;
  return V;
};
const V = { opus: load(W2, 'opus') };
for (const j of JUDGES) V[j] = fs.existsSync(path.join(RUN, 'verdicts', j)) ? load(RUN, j) : load(W2, j);
const gate = Object.fromEntries(['opus', ...JUDGES].map((j) => {
  const f = path.join(OUT, `report-${j}.json`);
  return [j, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).controls_gate : null];
}));
const subset = args.subset ? new Set(fs.readFileSync(args.subset, 'utf8').split(/\s+/).filter(Boolean)) : null;

/** analyze-wave2.mjs estimate(), unchanged: post-stratified by language (× arm) with a seeded bootstrap of books in each cell. */
function estimate(items, V, pred, { langW, armShares = null, iters = ITERS, seed = 20261030 } = {}) {
  const byLang = {};
  for (const m of items) if (V[m.id]) (byLang[m.language] ||= []).push(m);
  const langs = Object.keys(byLang).filter((l) => langW[l]);
  const tot = langs.reduce((s, l) => s + langW[l], 0);
  const cellsOf = (l) => {
    if (!armShares || !armShares[l]) return [[1, byLang[l]]];
    const cs = Object.entries(armShares[l]).map(([a, w]) => [w, byLang[l].filter((m) => m.arm === a)]).filter(([, c]) => c.length);
    const cov = cs.reduce((s, [w]) => s + w, 0);
    return cs.map(([w, c]) => [w / cov, c]);
  };
  const plan = langs.map((l) => [langW[l] / tot, cellsOf(l)]);
  const point = plan.reduce((s, [lw, cs]) => s + lw * cs.reduce((x, [w, c]) => x + w * c.filter((m) => pred(V[m.id])).length / c.length, 0), 0);
  resetSeed(seed);
  const draws = [];
  for (let i = 0; i < iters; i++) {
    let e = 0;
    for (const [lw, cs] of plan) for (const [w, c] of cs) { let k = 0; for (let j = 0; j < c.length; j++) k += pred(V[c[Math.floor(seededRand() * c.length)].id]) ? 1 : 0; e += lw * w * k / c.length; }
    draws.push(e);
  }
  const sorted = [...draws].sort((a, b) => a - b);
  return { est: pct(point), ci: [pct(sorted[Math.floor(iters * 0.025)]), pct(sorted[Math.floor(iters * 0.975)])], n: items.filter((m) => V[m.id]).length, draws };
}
// Two judges over the same books and seed resample the same books, so draw i of one pairs with draw i of the other.
const diffCI = (a, b) => { const d = a.draws.map((x, i) => x - b.draws[i]).sort((x, y) => x - y); return { est: +(a.est - b.est).toFixed(1), ci: [pct(d[Math.floor(d.length * 0.025)]), pct(d[Math.floor(d.length * 0.975)])] }; };

const MEASURES = [['fidelity', (v) => v.fidelity, 'ordinal'], ['fidelity_ge4', (v) => ge4(v) ? 1 : 0, 'nominal'], ['major_defect', (v) => major(v) ? 1 : 0, 'nominal'],
  ['omission', (v) => v.flags?.omission ? 1 : 0, 'nominal'], ['invention', (v) => v.flags?.invention ? 1 : 0, 'nominal'], ['ocr_misread', (v) => v.ocr_misread ? 1 : 0, 'nominal']];
function reliability(A, B, items) {
  const both = items.filter((m) => V[A][m.id] && V[B][m.id]);
  const rel = {};
  for (const [name, f, level] of MEASURES) {
    resetSeed(7);
    const r = judgeReliability(both.map((m) => ({ cluster: m.book_id, values: [f(V[A][m.id]), f(V[B][m.id])] })), { level, rng: seededRand });
    rel[name] = { alpha: r.alpha == null ? null : +r.alpha.toFixed(3), ci: r.ci && r.ci.map((x) => +x.toFixed(3)), n: r.n_units, verdict: r.verdict, line: reliabilityLine(name, r, 'books') };
  }
  const d = both.map((m) => V[A][m.id].fidelity - V[B][m.id].fidelity);
  return { pair: [A, B], n: both.length, exact: pct(d.filter((x) => x === 0).length / d.length), within1: pct(d.filter((x) => Math.abs(x) <= 1).length / d.length), mean_a_minus_b: +(d.reduce((s, x) => s + x, 0) / d.length).toFixed(3), measures: rel };
}

/** analyze-wave2.mjs §4: (Opus − B) on Claude-translated pages minus the same on Gemini-translated pages. */
function selfPreference(A, B, items) {
  const both = items.filter((m) => V[A][m.id] && V[B][m.id] && familyOf(m.arm));
  const fam = groupBy(both, (m) => familyOf(m.arm));
  const gap = (ms) => ms.reduce((s, m) => s + V[A][m.id].fidelity - V[B][m.id].fidelity, 0) / ms.length;
  const gapBin = (ms, f) => ms.reduce((s, m) => s + (f(V[A][m.id]) ? 1 : 0) - (f(V[B][m.id]) ? 1 : 0), 0) / ms.length;
  const rs = (ms) => ms.map(() => ms[Math.floor(seededRand() * ms.length)]);
  const ci = (xs) => { xs.sort((a, b) => a - b); return [+xs[Math.floor(xs.length * 0.025)].toFixed(3), +xs[Math.floor(xs.length * 0.975)].toFixed(3)]; };
  const sp = { judge_a: A, judge_b: B, n_claude: fam.claude?.length || 0, n_gemini: fam.gemini?.length || 0 };
  if (!fam.claude || !fam.gemini) return sp;
  for (const [name, g] of [['fidelity', gap], ['ge4_share', (ms) => gapBin(ms, ge4)], ['major_share', (ms) => gapBin(ms, (v) => !major(v))]]) {
    resetSeed(11);
    const bs = []; for (let i = 0; i < ITERS; i++) bs.push(g(rs(fam.claude)) - g(rs(fam.gemini)));
    sp[name] = { claude_gap: +g(fam.claude).toFixed(3), gemini_gap: +g(fam.gemini).toFixed(3), did: +(g(fam.claude) - g(fam.gemini)).toFixed(3), ci: ci(bs) };
  }
  const cells = Object.values(groupBy(both, (m) => `${m.language}|${m.script}`)).map((ms) => groupBy(ms, (m) => familyOf(m.arm))).filter((c) => c.claude && c.gemini);
  const matched = (pick) => { let s = 0, w = 0; for (const c of cells) { const cl = pick(c.claude), ge = pick(c.gemini), wt = Math.min(cl.length, ge.length); s += wt * (gap(cl) - gap(ge)); w += wt; } return s / w; };
  resetSeed(13);
  const bs = []; for (let i = 0; i < ITERS; i++) bs.push(matched(rs));
  sp.fidelity_matched = { cells: cells.length, did: +matched((x) => x).toFixed(3), ci: ci(bs) };
  return sp;
}

// The by-eye table in wave 2's eye-notes.md §1: | # | item | lang | Opus | Gemini | read | right |.
const eye = [...fs.readFileSync(path.join(W2, 'eye-notes.md'), 'utf8').matchAll(/^\| (\d+) \| ([0-9a-f]{10}) \| ([^|]+) \| (\d) \| (\d) \| [^\n]*\| ([^|]+) \|$/gm)]
  .map((x) => ({ n: +x[1], id: x[2], language: x[3].trim(), opus: +x[4], flash_low: +x[5], right: x[6].trim().toLowerCase() }));
const eyeSide = (e) => e.right.startsWith('opus') ? 'opus' : e.right.startsWith('gemini') ? 'gemini' : e.right;

const out = { at: new Date().toISOString(), wave2: W2, run: RUN, judges: JUDGES, n_main: main.length, spread_flagged: manifest.filter((m) => m.spread_flag).map((m) => m.id), gate };
const spreadIds = new Set(out.spread_flagged);

out.headline = {};
for (const j of ['opus', ...JUDGES]) {
  const items = main.filter((m) => V[j][m.id]);
  if (!items.length) continue;
  // A judge that saw only the subset (mostly disputed books, one per cell) gets raw shares, never a corpus estimate:
  // with one book a cell the bootstrap has nothing to resample and its interval collapses to a point.
  if (items.length < 100) { out.headline[j] = { n: items.length, gate_pass: gate[j]?.pass ?? null, subset_only: true, ge4_share: pct(items.filter((m) => ge4(V[j][m.id])).length / items.length), major_share: pct(items.filter((m) => major(V[j][m.id])).length / items.length), fid5_share: pct(items.filter((m) => V[j][m.id].fidelity === 5).length / items.length), ocr_wrong_leaf_n: items.filter((m) => V[j][m.id].ocr_wrong_leaf).length }; continue; }
  out.headline[j] = { n: items.length, gate_pass: gate[j]?.pass ?? null,
    ge4_lang_x_arm: estimate(main, V[j], ge4, { langW, armShares }), major_lang_x_arm: estimate(main, V[j], major, { langW, armShares }),
    ge4_lang: estimate(main, V[j], ge4, { langW }), major_lang: estimate(main, V[j], major, { langW }),
    fid5_share: pct(items.filter((m) => V[j][m.id].fidelity === 5).length / items.length), major_share: pct(items.filter((m) => major(V[j][m.id])).length / items.length),
    ocr_wrong_leaf_n: items.filter((m) => V[j][m.id].ocr_wrong_leaf).length };
}

for (const j of JUDGES) {
  const h = out.headline[j];
  if (!h || h.subset_only || main.some((m) => !V.opus[m.id] !== !V[j][m.id])) continue;
  h.opus_minus_judge = { ge4_lang_x_arm: diffCI(out.headline.opus.ge4_lang_x_arm, h.ge4_lang_x_arm), major_lang_x_arm: diffCI(out.headline.opus.major_lang_x_arm, h.major_lang_x_arm) };
}
for (const h of Object.values(out.headline)) for (const v of Object.values(h)) if (v && v.draws) delete v.draws;

out.reliability = {};
for (const j of JUDGES) {
  const judged = main.filter((m) => V[j][m.id]);
  out.reliability[j] = { all: reliability('opus', j, main) };
  if (judged.some((m) => spreadIds.has(m.id))) out.reliability[j].no_spread = reliability('opus', j, main.filter((m) => !spreadIds.has(m.id)));
  if (subset && judged.length > subset.size) out.reliability[j].subset = reliability('opus', j, main.filter((m) => subset.has(m.id)));
}
// Does judge B agree with Opus better than judge A does? α(Opus, B) − α(Opus, A) on the books all three rated,
// paired bootstrap of books (one page a book, so books are the units).
out.alpha_diff = {};
for (let a = 0; a < JUDGES.length; a++) for (let b = a + 1; b < JUDGES.length; b++) {
  const [A, B] = [JUDGES[a], JUDGES[b]], items = main.filter((m) => V.opus[m.id] && V[A][m.id] && V[B][m.id]);
  if (items.length < 100) continue;
  out.alpha_diff[`${B} − ${A}`] = Object.fromEntries(MEASURES.slice(0, 3).map(([name, f, level]) => {
    const al = (ms, J) => krippendorffAlpha(ms.map((m) => [f(V.opus[m.id]), f(V[J][m.id])]), level);
    resetSeed(17);
    const xs = []; for (let i = 0; i < ITERS; i++) { const s = items.map(() => items[Math.floor(seededRand() * items.length)]); xs.push(al(s, B) - al(s, A)); }
    xs.sort((x, y) => x - y);
    return [name, { n: items.length, est: +(al(items, B) - al(items, A)).toFixed(3), ci: [+xs[Math.floor(ITERS * 0.025)].toFixed(3), +xs[Math.floor(ITERS * 0.975)].toFixed(3)] }];
  }));
}
out.reliability_gemini_pairs = {};
for (let a = 0; a < JUDGES.length; a++) for (let b = a + 1; b < JUDGES.length; b++) {
  const items = main.filter((m) => V[JUDGES[a]][m.id] && V[JUDGES[b]][m.id]);
  if (items.length >= 10) out.reliability_gemini_pairs[`${JUDGES[a]}|${JUDGES[b]}`] = reliability(JUDGES[a], JUDGES[b], items);
}
out.self_preference = Object.fromEntries(JUDGES.filter((j) => main.filter((m) => V[j][m.id]).length >= 100).map((j) => [j, selfPreference('opus', j, main)]));

// The 20 disputed books: each judge's score next to the by-eye side. A judge "agrees with the eye" on an Opus-right
// book when it gives Opus's score or one point from it AND is no closer to wave-2 Gemini's; on a tie (scores one
// apart, same finding) when it is within one of both. Split and unsettled rows are listed, not counted.
out.disputed = eye.map((e) => ({ ...e, side: eyeSide(e), scores: Object.fromEntries(['opus', ...JUDGES].map((j) => [j, V[j][e.id]?.fidelity ?? null])),
  reasons: Object.fromEntries(JUDGES.map((j) => [j, V[j][e.id]?.reason ?? null])) }));
out.disputed_tally = Object.fromEntries(JUDGES.map((j) => {
  const t = { judged: 0, opus_side: { n: 0, agree: 0, exact_opus: 0 }, tie: { n: 0, agree: 0 }, other: 0 };
  for (const e of out.disputed) {
    const s = e.scores[j];
    if (s == null) continue;
    t.judged++;
    if (e.side === 'opus') { t.opus_side.n++; if (Math.abs(s - e.opus) <= 1 && Math.abs(s - e.opus) <= Math.abs(s - e.flash_low)) t.opus_side.agree++; if (s === e.opus) t.opus_side.exact_opus++; }
    else if (e.side === 'tie') { t.tie.n++; if (Math.abs(s - e.opus) <= 1 && Math.abs(s - e.flash_low) <= 1) t.tie.agree++; }
    else t.other++;
  }
  return [j, t];
}));

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'analysis.json'), JSON.stringify(out, null, 2));
const f = (e) => e ? `${e.est}% (${e.ci.join('–')})` : '—';
let md = `# Gemini re-judge of wave 2 — analysis (${out.at.slice(0, 10)})\n\nmeasure = \`judged\`; rates of BOOKS (one interior page each), post-stratified by language × model arm unless marked "lang". Opus and gemini-flash-low verdicts are wave 2's; the others are this run's.\n\n`;
md += `## Gate (score.mjs --gate)\n| judge | swap ≤2 | drop → omission | repeat within one | pass |\n|---|---|---|---|---|\n`;
for (const [j, g] of Object.entries(gate)) if (g) md += `| ${j} | ${g.checks.swap.n ? Math.round(g.checks.swap.rate * g.checks.swap.n) : 0}/${g.checks.swap.n} | ${Math.round(g.checks.drop.rate * g.checks.drop.n)}/${g.checks.drop.n} | ${Math.round(g.checks.repeat.rate * g.checks.repeat.n)}/${g.checks.repeat.n} | ${g.pass ? 'PASS' : 'FAIL'} |\n`;
md += `\n## Headline per judge (only a passing judge's rates are corpus estimates)\n| judge | gate | n | ≥4 | major | ≥4 (lang) | major (lang) | fidelity 5 (raw) | wrong leaf |\n|---|---|---:|---:|---:|---:|---:|---:|---:|\n`;
for (const [j, h] of Object.entries(out.headline)) if (h.subset_only) md += `| ${j} | ${h.gate_pass == null ? '—' : h.gate_pass ? 'PASS' : 'FAIL'} | ${h.n} | raw ${h.ge4_share}% | raw ${h.major_share}% | — | — | ${h.fid5_share}% | ${h.ocr_wrong_leaf_n} |\n`; else md += `| ${j} | ${h.gate_pass == null ? '—' : h.gate_pass ? 'PASS' : 'FAIL'} | ${h.n} | ${f(h.ge4_lang_x_arm)} | ${f(h.major_lang_x_arm)} | ${f(h.ge4_lang)} | ${f(h.major_lang)} | ${h.fid5_share}% | ${h.ocr_wrong_leaf_n} |\n`;
md += '\n' + Object.entries(out.headline).filter(([, h]) => h.opus_minus_judge).map(([j, h]) => `Opus − ${j} (paired bootstrap): ≥4 ${h.opus_minus_judge.ge4_lang_x_arm.est} pp [${h.opus_minus_judge.ge4_lang_x_arm.ci.join(', ')}], major ${h.opus_minus_judge.major_lang_x_arm.est} pp [${h.opus_minus_judge.major_lang_x_arm.ci.join(', ')}]`).join('  \n') + '\n';
for (const [j, r] of Object.entries(out.reliability)) for (const [scope, x] of Object.entries(r)) md += `\n## α Opus vs ${j} — ${scope} (${x.n} books)\nexact ${x.exact}%, within one ${x.within1}%, mean(Opus − ${j}) ${x.mean_a_minus_b}\n\n` + Object.values(x.measures).map((m) => `- ${m.line}`).join('\n') + '\n';
for (const [k, x] of Object.entries(out.alpha_diff)) md += `\n## α vs Opus, ${k} (paired bootstrap, ${Object.values(x)[0].n} books)\n` + Object.entries(x).map(([m, d]) => `- ${m}: Δα ${d.est} [${d.ci.join(', ')}]`).join('\n') + '\n';
for (const [k, x] of Object.entries(out.reliability_gemini_pairs)) md += `\n## α ${k.replace('|', ' vs ')} (${x.n} books)\nexact ${x.exact}%, within one ${x.within1}%, mean(A − B) ${x.mean_a_minus_b}\n\n` + Object.values(x.measures).map((m) => `- ${m.line}`).join('\n') + '\n';
md += `\n## Self-preference (Opus − judge on Claude-translated pages, minus the same on Gemini-translated pages)\n\`\`\`\n${JSON.stringify(out.self_preference, null, 1)}\n\`\`\`\n`;
md += `\n## The 20 disputed books (wave 2 eye-notes.md §1)\n| # | item | lang | by eye | ${['opus', ...JUDGES].join(' | ')} |\n|---:|---|---|---|${['opus', ...JUDGES].map(() => '---:').join('|')}|\n` + out.disputed.map((e) => `| ${e.n} | ${e.id} | ${e.language} | ${e.right} | ${['opus', ...JUDGES].map((j) => e.scores[j] ?? '—').join(' | ')} |`).join('\n') + '\n';
md += `\n\`\`\`\n${JSON.stringify(out.disputed_tally, null, 1)}\n\`\`\`\n`;
fs.writeFileSync(path.join(OUT, 'analysis.md'), md);
console.error(`analysis → ${OUT}/analysis.{json,md}`);
