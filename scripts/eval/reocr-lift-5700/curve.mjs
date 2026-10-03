#!/usr/bin/env node
// PRIOR ART: scripts/eval/benchmark-dashboard-data.mjs and benchmark-score.mjs score OCR against references and
// grade cells, with no translation score beside them; scripts/eval/translation-vs-reference/score.mjs scores
// translations with no OCR error beside them. #5700 named the gap: OCR error × translation fidelity on the SAME
// pages. This joins the two for the #5695 track pages that have a by-eye corrected transcription.
/** $0 propagation curve (#5700 A5): CER(served OCR vs corrected transcription) × the fidelity each #5695 track measured on the OCR and on the corrected text. */
/**
 *   node scripts/eval/reocr-lift-5700/curve.mjs [--dir scripts/eval/results/reocr-lift-2026-10]
 * Reads <dir>/track-pages.jsonl (load-tracks.mjs). Writes <dir>/curve.json and <dir>/curve.md. No network, no Mongo.
 * measure: CER here is distance to a by-eye correction of the served OCR (see threats in curve.md), fidelity is
 * "judged against a human reference" from each track. Neither is accuracy in the eval-design §2 sense.
 */
import fs from 'node:fs';
import path from 'node:path';
import { errorRates } from './text-distance.mjs';
import { bootstrapCI, resetSeed, mean } from '../lib/paired-stats.mjs';

const args = process.argv.slice(2);
const DIR = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : 'scripts/eval/results/reocr-lift-2026-10';
const rows = fs.readFileSync(path.join(DIR, 'track-pages.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.has_corrected);
const r3 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);

export const SCRIPT_GROUP = { Latin: 'Latin', German: 'vernacular (Latin script)', French: 'vernacular (Latin script)', Italian: 'vernacular (Latin script)', Dutch: 'vernacular (Latin script)', Spanish: 'vernacular (Latin script)',
  'Ancient Greek': 'Greek', 'Byzantine Greek': 'Greek', Hebrew: 'Hebrew/Aramaic', Aramaic: 'Hebrew/Aramaic', Arabic: 'Arabic', Persian: 'Persian', Sanskrit: 'Sanskrit', Pali: 'Pali', Chinese: 'Chinese' };
export const CER_BINS = [[0, 0.02, '< 2 %'], [0.02, 0.05, '2–5 %'], [0.05, 0.10, '5–10 %'], [0.10, 0.20, '10–20 %'], [0.20, Infinity, '≥ 20 %']];
export const binOf = (c) => CER_BINS.find(([lo, hi]) => c >= lo && c < hi)[2];

const pages = rows.map((r) => {
  const e = errorRates(r.ocr_text, r.corrected_text); const t = r.track_fidelity;
  return { id: r.id, track: r.track, lang: r.lang, script: SCRIPT_GROUP[r.lang], stratum: r.stratum, primary_cause: r.primary_cause, served_fidelity: r.served_fidelity,
    cer: r3(e.cer), wer: r3(e.wer), cer_bin: binOf(e.cer), corrected_chars: e.ref_chars,
    lite_ocr: t.lite_ocr, lite_corr: t.lite_corr, lite_delta: t.lite_corr != null && t.lite_ocr != null ? t.lite_corr - t.lite_ocr : null,
    flash_ocr: t.flash_ocr, flash_corr: t.flash_corr, flash_delta: t.flash_corr != null && t.flash_ocr != null ? t.flash_corr - t.flash_ocr : null, judges: t.judges };
});

function cell(ps) {
  resetSeed(5700);
  const d = ps.map((p) => p.lite_delta).filter((x) => x != null), f = ps.map((p) => p.flash_delta).filter((x) => x != null);
  const ci = (xs) => { if (xs.length < 2) return null; const b = bootstrapCI(xs); return [r3(b.lo ?? b[0]), r3(b.hi ?? b[1])]; };
  return { n: ps.length, cer_median: r3([...ps.map((p) => p.cer)].sort((a, b) => a - b)[Math.floor(ps.length / 2)]), cer_mean: r3(mean(ps.map((p) => p.cer))),
    lite_ocr: r3(mean(ps.map((p) => p.lite_ocr).filter((x) => x != null))), lite_corr: r3(mean(ps.map((p) => p.lite_corr).filter((x) => x != null))),
    lite_delta: d.length ? r3(mean(d)) : null, lite_delta_ci: ci(d), flash_n: f.length, flash_delta: f.length ? r3(mean(f)) : null, flash_delta_ci: ci(f) };
}
const group = (key) => { const g = {}; for (const p of pages) (g[key(p)] ||= []).push(p); return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, cell(v)])); };
// Least-squares slope of the fidelity gain on CER, with a page bootstrap, and Spearman's rho.
function slope(ps, f) {
  const xy = ps.filter((p) => p[f] != null).map((p) => [p.cer, p[f]]);
  const fit = (a) => { const mx = mean(a.map((v) => v[0])), my = mean(a.map((v) => v[1])); const sxx = a.reduce((s, v) => s + (v[0] - mx) ** 2, 0); return sxx ? a.reduce((s, v) => s + (v[0] - mx) * (v[1] - my), 0) / sxx : 0; };
  const rank = (v) => { const s = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = Array(v.length); for (let i = 0; i < s.length;) { let j = i; while (j < s.length && s[j][0] === s[i][0]) j++; for (let k = i; k < j; k++) r[s[k][1]] = (i + j - 1) / 2; i = j; } return r; };
  const rx = rank(xy.map((v) => v[0])), ry = rank(xy.map((v) => v[1])); const rho = (() => { const a = rx.map((x, i) => [x, ry[i]]); const mx = mean(rx), my = mean(ry); const sx = Math.sqrt(a.reduce((s, v) => s + (v[0] - mx) ** 2, 0)), sy = Math.sqrt(a.reduce((s, v) => s + (v[1] - my) ** 2, 0)); return a.reduce((s, v) => s + (v[0] - mx) * (v[1] - my), 0) / (sx * sy); })();
  let seed = 5700; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const bs = []; for (let i = 0; i < 4000; i++) bs.push(fit(Array.from({ length: xy.length }, () => xy[Math.floor(rnd() * xy.length)])));
  bs.sort((a, b) => a - b);
  return { n: xy.length, fidelity_points_per_10pp_cer: r3(fit(xy) / 10), ci: [r3(bs[100] / 10), r3(bs[3899] / 10)], spearman_rho: r3(rho) };
}

const out = {
  generated: new Date().toISOString(), question: '#5700 A5: how much translation fidelity is lost per unit of OCR error, per script?',
  measure: { cer: 'edit distance of the served OCR to the track\'s by-eye corrected transcription, letters only, per-script folds (text-distance.mjs); NOT accuracy against an independent reference', fidelity: 'judged against a human reference (#5695 harness; each track\'s own judges and call shape)' },
  n_pages: pages.length, by_cer_bin: Object.fromEntries(CER_BINS.map(([, , l]) => [l, cell(pages.filter((p) => p.cer_bin === l))]).filter(([, c]) => c.n)),
  by_script: group((p) => p.script), by_track: group((p) => p.track), by_cause: group((p) => p.primary_cause ?? 'not classified (T1, T3)'),
  by_script_and_bin: group((p) => `${p.script} | ${p.cer_bin}`),
  slope_lite: slope(pages, 'lite_delta'), slope_flash: slope(pages, 'flash_delta'),
  slope_lite_level: slope(pages, 'lite_ocr'),
  pages,
};
fs.writeFileSync(path.join(DIR, 'curve.json'), JSON.stringify(out, null, 1));

const f2 = (x) => (x == null ? '—' : (x >= 0 ? '+' : '') + x.toFixed(2)); const lv = (x) => (x == null ? '—' : x.toFixed(2)); const pc = (x) => (x == null ? '—' : (100 * x).toFixed(1) + ' %');
const ci = (c) => (c ? ` [${f2(c[0])}, ${f2(c[1])}]` : '');
const table = (title, obj, first) => [`### ${title}`, '', `| ${first} | n | median CER | Lite on OCR | Lite on corrected | Lite Δ [95 % CI] | Flash Δ [95 % CI] (n) |`, '|---|---:|---:|---:|---:|---|---|',
  ...Object.entries(obj).map(([k, c]) => `| ${k} | ${c.n} | ${pc(c.cer_median)} | ${lv(c.lite_ocr)} | ${lv(c.lite_corr)} | ${f2(c.lite_delta)}${ci(c.lite_delta_ci)} | ${f2(c.flash_delta)}${ci(c.flash_delta_ci)} (${c.flash_n}) |`), ''].join('\n');
const order = (o, keys) => Object.fromEntries(keys.filter((k) => o[k]).map((k) => [k, o[k]]));
const scripts = ['Latin', 'vernacular (Latin script)', 'Greek', 'Hebrew/Aramaic', 'Arabic', 'Persian', 'Sanskrit', 'Pali', 'Chinese'];
const md = [`# OCR error × translation fidelity on the same pages ($0, from the #5695 tracks)`, '',
  `${pages.length} pages from the five #5695 tracks have a transcription corrected by eye. For each: CER of the served OCR against the corrected text, and the fidelity the track measured for Lite (and Flash where run) on the OCR and on the corrected text. Generated by \`scripts/eval/reocr-lift-5700/curve.mjs\`; every page is in \`curve.json\`.`, '',
  table('By CER bin (all scripts)', out.by_cer_bin, 'CER of the served OCR'), table('By script', order(out.by_script, scripts), 'script'), table('By primary cause (image opened)', out.by_cause, 'cause'), table('By track', out.by_track, 'track'),
  `### Script × CER bin (cells with n ≥ 3)`, '', '| script | CER bin | n | Lite Δ | Flash Δ |', '|---|---|---:|---:|---:|',
  ...scripts.flatMap((s) => CER_BINS.map(([, , l]) => [s, l, out.by_script_and_bin[`${s} | ${l}`]])).filter(([, , c]) => c && c.n >= 3).map(([s, l, c]) => `| ${s} | ${l} | ${c.n} | ${f2(c.lite_delta)} | ${f2(c.flash_delta)} |`), '',
  `**Slope.** Lite gains ${f2(out.slope_lite.fidelity_points_per_10pp_cer)} fidelity points per 10 points of CER removed [${f2(out.slope_lite.ci[0])}, ${f2(out.slope_lite.ci[1])}] (Spearman ρ ${out.slope_lite.spearman_rho}, n ${out.slope_lite.n}); Flash ${f2(out.slope_flash.fidelity_points_per_10pp_cer)} [${f2(out.slope_flash.ci[0])}, ${f2(out.slope_flash.ci[1])}] (ρ ${out.slope_flash.spearman_rho}, n ${out.slope_flash.n}). Lite's fidelity on the uncorrected OCR falls ${f2(out.slope_lite_level.fidelity_points_per_10pp_cer)} per 10 points of CER (ρ ${out.slope_lite_level.spearman_rho}).`, ''].join('\n');
fs.writeFileSync(path.join(DIR, 'curve.md'), md);
console.log(md);
