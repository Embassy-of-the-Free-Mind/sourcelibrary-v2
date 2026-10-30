#!/usr/bin/env node
// PRIOR ART: score.mjs (one judge's controls, cells and language-weighted estimate — run first, per judge, for the gate);
// lib/agreement-stats.mjs judgeReliability (Krippendorff α, bootstrap by book); lib/paired-stats.mjs (seeded rng).
// score.mjs has no estimate weighted by language × arm WITH an interval, no second-judge α, no self-preference, no
// cross-run delta and no image fields. This adds those for wave 2 of #5274 and writes analysis.json + analysis.md.
//
//   node scripts/eval/translation-corpus-audit/analyze-wave2.mjs --dir scripts/eval/results/translation-corpus-audit-wave2-2026-10-30 \
//        --judges opus,gemini-flash-low --wave1 scripts/eval/results/translation-corpus-audit-2026-09-30 \
//        --monthly scripts/eval/results/translation-corpus-audit-monthly-2026-10
//
// Estimators (all rates are of BOOKS, one interior page each; measure = judged):
//   lang      post-stratified by language (weights: eligible translated pages per language) — the 09-30 headline form
//   lang×arm  post-stratified by language × model arm (arm-shares.json), the headline here: the draw floored small arms
//             at 6 books, so a language-only weight over-represents them. Empty cells fall back to the language rate.
// CI: 2000 seeded bootstrap resamples of books within each cell.

import fs from 'node:fs';
import path from 'node:path';
import { resetSeed, seededRand } from '../lib/paired-stats.mjs';
import { judgeReliability, reliabilityLine } from '../lib/agreement-stats.mjs';
import { familyOf } from './arm.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const DIR = args.dir, JUDGES = String(args.judges || 'opus,gemini-flash-low').split(','), ITERS = 2000;
const readJsonl = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : [];
const pct = (x) => x == null ? null : +(100 * x).toFixed(1);
const ge4 = (v) => v.fidelity >= 4, major = (v) => (v.defects || []).some((d) => d.severity === 'major');

function loadRun(dir, judges) {
  const manifest = readJsonl(path.join(dir, 'manifest.jsonl'));
  const log = JSON.parse(fs.readFileSync(path.join(dir, 'draw-log.json'), 'utf8'));
  const armShares = fs.existsSync(path.join(dir, 'arm-shares.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'arm-shares.json'), 'utf8')) : null;
  const V = {};
  for (const j of judges) {
    V[j] = {};
    const d = path.join(dir, 'verdicts', j);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.jsonl'))) for (const v of readJsonl(path.join(d, f))) if (v.id && typeof v.fidelity === 'number') V[j][v.id] = v;
  }
  return { dir, manifest, main: manifest.filter((m) => m.kind === 'main'), log, armShares, V };
}

/** Post-stratified estimate and bootstrap CI. weights: { lang: share } and optional armShares { lang: { arm: share } }. */
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
  // `draws` stay in resample order: diffCI pairs draw i of one run with draw i of another. Sorting them here paired
  // quantile with quantile and gave a difference interval of ±0.3 pp (first version of this script).
  const sorted = [...draws].sort((a, b) => a - b);
  return { est: pct(point), ci: [pct(sorted[Math.floor(iters * 0.025)]), pct(sorted[Math.floor(iters * 0.975)])], n: items.filter((m) => V[m.id]).length, draws };
}
const langWeights = (log) => Object.fromEntries(Object.entries(log.weights).map(([l, w]) => [l, w.translated_pages]));
const diffCI = (a, b) => { const d = a.draws.map((x, i) => x - b.draws[i]).sort((x, y) => x - y); return { est: +(a.est - b.est).toFixed(1), ci: [pct(d[Math.floor(d.length * 0.025)]), pct(d[Math.floor(d.length * 0.975)])] }; };
const strip = (e) => e && { est: e.est, ci: e.ci, n: e.n };

const run = loadRun(DIR, JUDGES);
const W = langWeights(run.log);
const out = { dir: DIR, judges: JUDGES, at: new Date().toISOString(), n_main: run.main.length, n_books: new Set(run.main.map((m) => m.book_id)).size };

// 1. Headline per judge.
out.headline = {};
for (const j of JUDGES) {
  const V = run.V[j];
  out.headline[j] = {
    n: run.main.filter((m) => V[m.id]).length,
    ge4_lang_x_arm: strip(estimate(run.main, V, ge4, { langW: W, armShares: run.armShares })),
    major_lang_x_arm: strip(estimate(run.main, V, major, { langW: W, armShares: run.armShares })),
    ge4_lang: strip(estimate(run.main, V, ge4, { langW: W })),
    major_lang: strip(estimate(run.main, V, major, { langW: W })),
    fid5_lang_x_arm: strip(estimate(run.main, V, (v) => v.fidelity === 5, { langW: W, armShares: run.armShares })),
    le2_lang_x_arm: strip(estimate(run.main, V, (v) => v.fidelity <= 2, { langW: W, armShares: run.armShares })),
    ocr_misread_lang_x_arm: strip(estimate(run.main, V, (v) => !!v.ocr_misread, { langW: W, armShares: run.armShares })),
    ocr_wrong_leaf_n: run.main.filter((m) => V[m.id]?.ocr_wrong_leaf).length,
    image_seen_n: run.main.filter((m) => V[m.id]?.image_seen).length,
  };
}

// The judge saw the image only if the words it says it read there are on the page: a check of image_first_words
// against the transcription (normalised, any 2 consecutive words, or for CJK/Tibetan any 3-character run).
const items = Object.fromEntries(readJsonl(path.join(DIR, 'items.jsonl')).map((x) => [x.id, x]));
function firstWordsMatch(words, m) {
  const norm = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/<[^>]+>/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/ſ/g, 's').replace(/\s+/g, ' ').trim();
  const w = norm(words), src = norm(items[m.id]?.source);
  if (!w || !src) return false;
  const toks = w.split(' ');
  if (toks.length >= 2) for (let i = 0; i + 1 < toks.length; i++) if (toks[i].length + toks[i + 1].length >= 5 && src.includes(`${toks[i]} ${toks[i + 1]}`)) return true;
  const flat = w.replace(/\s/g, ''), sflat = src.replace(/\s/g, '');
  for (let i = 0; i + 3 <= flat.length; i++) if (/[^\x00-\x7f]/.test(flat[i]) && sflat.includes(flat.slice(i, i + 3))) return true;
  return false;
}
for (const j of JUDGES) out.headline[j].image_words_match_n = run.main.filter((m) => run.V[j][m.id] && firstWordsMatch(run.V[j][m.id].image_first_words, m)).length;

// 2. Descriptive breakdowns (primary judge first), and arm contrasts only inside language × script × period cells.
const groupBy = (arr, f) => { const o = {}; for (const x of arr) (o[f(x)] ||= []).push(x); return o; };
const cellRate = (ms, V) => { const vs = ms.map((m) => V[m.id]).filter(Boolean); return { n: vs.length, ge4: pct(vs.filter(ge4).length / vs.length), major: pct(vs.filter(major).length / vs.length), mean: +(vs.reduce((s, v) => s + v.fidelity, 0) / vs.length).toFixed(2) }; };
out.breakdowns = {};
for (const j of JUDGES) {
  const V = run.V[j], b = {};
  for (const [name, f] of [['language', (m) => m.language], ['script', (m) => m.script], ['period', (m) => m.period], ['arm', (m) => m.arm], ['engine_api', (m) => m.engine_api || '(none recorded)'], ['prompt_version', (m) => `${m.arm}/${m.prompt_version ?? '(none)'}`], ['language_script', (m) => `${m.language}/${m.script}`]])
    b[name] = Object.fromEntries(Object.entries(groupBy(run.main, f)).sort((x, y) => y[1].length - x[1].length).map(([k, ms]) => [k, cellRate(ms, V)]));
  b.within_cell_arms = Object.fromEntries(Object.entries(groupBy(run.main, (m) => `${m.language}|${m.script}|${m.period}`))
    .map(([k, ms]) => [k, Object.fromEntries(Object.entries(groupBy(ms, (m) => m.arm)).map(([a, xs]) => [a, cellRate(xs, V)]))])
    .filter(([, arms]) => Object.keys(arms).length >= 2));
  out.breakdowns[j] = b;
}

// 3. Judge reliability (α, bootstrap by book) — main items both judges rated.
if (JUDGES.length >= 2) {
  const [A, B] = JUDGES, both = run.main.filter((m) => run.V[A][m.id] && run.V[B][m.id]);
  const units = (f) => both.map((m) => ({ cluster: m.book_id, values: [f(run.V[A][m.id]), f(run.V[B][m.id])] }));
  const rel = {};
  for (const [name, f, level] of [['fidelity', (v) => v.fidelity, 'ordinal'], ['fidelity_ge4', (v) => ge4(v) ? 1 : 0, 'nominal'], ['major_defect', (v) => major(v) ? 1 : 0, 'nominal'],
    ['omission', (v) => v.flags?.omission ? 1 : 0, 'nominal'], ['invention', (v) => v.flags?.invention ? 1 : 0, 'nominal'], ['ocr_misread', (v) => v.ocr_misread ? 1 : 0, 'nominal']]) {
    resetSeed(7);
    const r = judgeReliability(units(f), { level, rng: seededRand });
    rel[name] = { ...r, line: reliabilityLine(name, r, 'books') };
  }
  const d = both.map((m) => run.V[A][m.id].fidelity - run.V[B][m.id].fidelity);
  out.reliability = { pair: [A, B], n: both.length, exact: pct(d.filter((x) => x === 0).length / d.length), within1: pct(d.filter((x) => Math.abs(x) <= 1).length / d.length), mean_a_minus_b: +(d.reduce((s, x) => s + x, 0) / d.length).toFixed(3), measures: rel };

  // 4. Self-preference: (A − B) on Claude-family translations minus (A − B) on Gemini-family ones. A is the Claude judge.
  //    Raw over all books, and matched: inside language × script cells holding both families, weighted by the
  //    smaller family's n. CI: seeded bootstrap of books within family (and within cell for the matched form).
  const fam = groupBy(both.filter((m) => familyOf(m.arm)), (m) => familyOf(m.arm));
  const gap = (ms) => ms.reduce((s, m) => s + run.V[A][m.id].fidelity - run.V[B][m.id].fidelity, 0) / ms.length;
  const gapBin = (ms, f) => ms.reduce((s, m) => s + (f(run.V[A][m.id]) ? 1 : 0) - (f(run.V[B][m.id]) ? 1 : 0), 0) / ms.length;
  const rs = (ms) => ms.map(() => ms[Math.floor(seededRand() * ms.length)]);
  const ci = (xs) => { xs.sort((a, b) => a - b); return [+xs[Math.floor(xs.length * 0.025)].toFixed(3), +xs[Math.floor(xs.length * 0.975)].toFixed(3)]; };
  const sp = { judge_a: A, judge_b: B, n_claude: fam.claude?.length || 0, n_gemini: fam.gemini?.length || 0 };
  if (fam.claude && fam.gemini) {
    for (const [name, g] of [['fidelity', gap], ['ge4_share', (ms) => gapBin(ms, ge4)], ['major_share', (ms) => gapBin(ms, (v) => !major(v))]]) {
      resetSeed(11);
      const est = g(fam.claude) - g(fam.gemini), bs = [];
      for (let i = 0; i < ITERS; i++) bs.push(g(rs(fam.claude)) - g(rs(fam.gemini)));
      sp[name] = { claude_gap: +g(fam.claude).toFixed(3), gemini_gap: +g(fam.gemini).toFixed(3), did: +est.toFixed(3), ci: ci(bs) };
    }
    const cells = Object.values(groupBy(both.filter((m) => familyOf(m.arm)), (m) => `${m.language}|${m.script}`)).map((ms) => groupBy(ms, (m) => familyOf(m.arm))).filter((c) => c.claude && c.gemini);
    const matched = (pick) => { let s = 0, w = 0; for (const c of cells) { const cl = pick(c.claude), ge = pick(c.gemini), wt = Math.min(cl.length, ge.length); s += wt * (gap(cl) - gap(ge)); w += wt; } return s / w; };
    resetSeed(13);
    const bs = []; for (let i = 0; i < ITERS; i++) bs.push(matched(rs));
    sp.fidelity_matched = { cells: cells.length, n_claude: cells.reduce((s, c) => s + c.claude.length, 0), n_gemini: cells.reduce((s, c) => s + c.gemini.length, 0), did: +matched((x) => x).toFixed(3), ci: ci(bs) };
  }
  out.self_preference = sp;

  // 6. The 20 books the judges disagree on most (|ΔA−B| desc, then lower min score), for the by-eye read.
  out.disputed = both.map((m) => ({ id: m.id, d: run.V[A][m.id].fidelity - run.V[B][m.id].fidelity, m })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d) || Math.min(run.V[A][x.id].fidelity, run.V[B][x.id].fidelity) - Math.min(run.V[A][y.id].fidelity, run.V[B][y.id].fidelity)).slice(0, 20)
    .map(({ id, d, m }) => ({ id, language: m.language, arm: m.arm, script: m.script, url: m.url, image: m.image, [A]: run.V[A][id].fidelity, [B]: run.V[B][id].fidelity, d, [`${A}_reason`]: run.V[A][id].reason, [`${B}_reason`]: run.V[B][id].reason }));
}

// 5. Wave 1 → wave 2, and the Oct-1 monthly draw (Opus, text-only, the unchanged instrument).
const P = JUDGES[0];
if (args.wave1) {
  const w1 = loadRun(args.wave1, ['opus']), w1W = langWeights(w1.log);
  const shared = (r) => r.main.filter((m) => ['lite', 'flash'].includes(m.arm));
  // Independent samples: each run gets its own bootstrap seed, so the paired draws in diffCI are independent.
  const e = (r, V, pred, langW, arm) => estimate(r, V, pred, { langW, armShares: arm, seed: r === w1.main ? 20260930 : 20261030 });
  const w1g = e(w1.main, w1.V.opus, ge4, w1W, w1.armShares), w1m = e(w1.main, w1.V.opus, major, w1W, w1.armShares);
  const w2g = e(run.main, run.V[P], ge4, W, run.armShares), w2m = e(run.main, run.V[P], major, W, run.armShares);
  const w2gs = e(shared(run), run.V[P], ge4, W, run.armShares), w2ms = e(shared(run), run.V[P], major, W, run.armShares);
  const w1gL = e(w1.main, w1.V.opus, ge4, w1W, null), w2gL = e(run.main, run.V[P], ge4, W, null);
  const w1mL = e(w1.main, w1.V.opus, major, w1W, null), w2mL = e(run.main, run.V[P], major, W, null);
  out.wave_delta = {
    note: 'wave 1 = 2026-09-30, Opus text-only; wave 2 = this run, Opus WITH the page image (the instrument changed as well as the corpus). lang×arm uses each run\'s own arm shares; "lite/flash only" restricts wave 2 to the two arms wave 1 could see.',
    wave1: { n: w1.main.length, ge4_lang_x_arm: strip(w1g), major_lang_x_arm: strip(w1m), ge4_lang: strip(w1gL), major_lang: strip(w1mL) },
    wave2: { n: run.main.length, ge4_lang_x_arm: strip(w2g), major_lang_x_arm: strip(w2m), ge4_lang: strip(w2gL), major_lang: strip(w2mL), ge4_lite_flash_only: strip(w2gs), major_lite_flash_only: strip(w2ms) },
    delta: { ge4_lang_x_arm: diffCI(w2g, w1g), major_lang_x_arm: diffCI(w2m, w1m), ge4_lang: diffCI(w2gL, w1gL), major_lang: diffCI(w2mL, w1mL), ge4_lite_flash_only: diffCI(w2gs, w1g), major_lite_flash_only: diffCI(w2ms, w1m) },
  };
}
if (args.monthly) {
  const mo = loadRun(args.monthly, ['opus']), moW = langWeights(mo.log);
  out.monthly_2026_10 = { n: mo.main.length, note: 'Oct-1 draw (seed 20261001, monthly design: language quotas, lite/flash only), judged 2026-10-30 by Opus text-only (JUDGE-PROMPT.md verbatim)',
    ge4_lang: strip(estimate(mo.main, mo.V.opus, ge4, { langW: moW })), major_lang: strip(estimate(mo.main, mo.V.opus, major, { langW: moW })) };
}

for (const h of Object.values(out.headline)) for (const v of Object.values(h)) if (v && v.draws) delete v.draws;
fs.writeFileSync(path.join(DIR, 'analysis.json'), JSON.stringify(out, null, 2));
const f = (e) => e ? `${e.est}% (${e.ci.join('–')})` : '—';
let md = `# Wave 2 analysis — ${path.basename(DIR)}\n\nmeasure = \`judged\`; ${out.n_main} books, one interior page each. Rates post-stratified by language × model arm unless marked "lang".\n\n| judge | n | ≥4 | major defect | ≥4 (lang) | major (lang) | fidelity 5 | ≤2 | OCR misread (image) | wrong leaf | image read (first words found in OCR) |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n`;
for (const [j, h] of Object.entries(out.headline)) md += `| ${j} | ${h.n} | ${f(h.ge4_lang_x_arm)} | ${f(h.major_lang_x_arm)} | ${f(h.ge4_lang)} | ${f(h.major_lang)} | ${f(h.fid5_lang_x_arm)} | ${f(h.le2_lang_x_arm)} | ${f(h.ocr_misread_lang_x_arm)} | ${h.ocr_wrong_leaf_n} | ${h.image_words_match_n}/${h.n} |\n`;
if (out.reliability) md += `\n## Judge reliability (${out.reliability.pair.join(' vs ')}, ${out.reliability.n} books)\nexact ${out.reliability.exact}%, within one ${out.reliability.within1}%, mean(A−B) ${out.reliability.mean_a_minus_b}\n\n` + Object.values(out.reliability.measures).map((r) => `- ${r.line}`).join('\n') + '\n';
if (out.self_preference) md += `\n## Self-preference\n\`\`\`\n${JSON.stringify(out.self_preference, null, 1)}\n\`\`\`\n`;
if (out.wave_delta) md += `\n## Wave 1 → wave 2\n\`\`\`\n${JSON.stringify(out.wave_delta, null, 1)}\n\`\`\`\n`;
if (out.monthly_2026_10) md += `\n## Oct-1 monthly draw\n\`\`\`\n${JSON.stringify(out.monthly_2026_10, null, 1)}\n\`\`\`\n`;
for (const j of JUDGES) {
  md += `\n## Breakdowns — ${j}\n`;
  for (const [name, cells] of Object.entries(out.breakdowns[j])) {
    if (name === 'within_cell_arms') { md += `\n### arms within language|script|period cells (cells < 10 books are exploratory)\n| cell | arm | n | mean | ≥4 | major |\n|---|---|---:|---:|---:|---:|\n` + Object.entries(cells).flatMap(([k, arms]) => Object.entries(arms).map(([a, c]) => `| ${k} | ${a} | ${c.n} | ${c.mean} | ${c.ge4} | ${c.major} |`)).join('\n') + '\n'; continue; }
    md += `\n### by ${name}\n| cell | n | mean | ≥4 | major |\n|---|---:|---:|---:|---:|\n` + Object.entries(cells).map(([k, c]) => `| ${k} | ${c.n} | ${c.mean} | ${c.ge4} | ${c.major} |`).join('\n') + '\n';
  }
}
if (out.disputed) md += `\n## 20 most disputed books\n| id | language | arm | ${JUDGES[0]} | ${JUDGES[1]} | url |\n|---|---|---|---:|---:|---|\n` + out.disputed.map((x) => `| ${x.id} | ${x.language} | ${x.arm} | ${x[JUDGES[0]]} | ${x[JUDGES[1]]} | ${x.url} |`).join('\n') + '\n';
fs.writeFileSync(path.join(DIR, 'analysis.md'), md);
console.error(`analysis → ${DIR}/analysis.{json,md}`);
