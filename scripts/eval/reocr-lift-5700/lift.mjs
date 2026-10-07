#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-vs-reference/score.mjs gives arms, pairs and its own strata (lang, track,
// style, canonical); it has no notion of which engine made the served OCR, of OCR error, or of a ceiling arm.
// This reads its per_page output and adds those cuts. Statistics from lib/paired-stats.mjs.
/** #5700 A5: the fidelity a real re-read buys (reocr − ocr) beside the by-eye ceiling (corr − ocr), per script, served engine, OCR-error bin and cause. */
/**
 *   node scripts/eval/reocr-lift-5700/lift.mjs [--dir scripts/eval/results/reocr-lift-2026-10]
 * Reads results.json (score.mjs), ocr-score.json, track-pages.jsonl. Writes lift.json and lift.md. No network.
 */
import fs from 'node:fs';
import path from 'node:path';
import { bootstrapCI, resetSeed, mean } from '../lib/paired-stats.mjs';
import { binOf, CER_BINS } from './text-distance.mjs';

const args = process.argv.slice(2);
const DIR = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : 'scripts/eval/results/reocr-lift-2026-10';
const rj = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const r2 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 100) / 100);
const res = rj('results.json'); const ocr = Object.fromEntries(rj('ocr-score.json').pages.map((p) => [p.id, p]));
const tp = Object.fromEntries(fs.readFileSync(path.join(DIR, 'track-pages.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.id, r]));
const hand = (t) => /<script>\s*(handwritten|manuscript)/i.test(t || '');
const period = (y) => (y == null ? 'undated' : y < 1501 ? 'to 1500' : y < 1600 ? '1501–1599' : y < 1800 ? '1600–1799' : '1800+');

const pages = res.per_page.map((p) => {
  const f = (a) => p.arms[a]?.fidelity ?? null; const o = ocr[p.id], t = tp[p.id];
  const rev = (a) => { const b = p.arms[a]?.by_judge; return b ? mean(Object.values(b).map((j) => (j?.reversal ? 1 : 0))) : null; };
  return { id: p.id, track: p.track, lang: p.lang, script: o.script, served_engine: o.served_engine, manuscript: t.stratum === 'manuscript' || hand(t.ocr_text), period: period(t.edition_year), cause: o.primary_cause ?? 'not classified',
    cer_served: o.cer_served, cer_reocr: o.cer_reocr, cer_bin: binOf(o.cer_served),
    lite_ocr: f('lite-ocr'), lite_reocr: f('lite-reocr'), lite_corr: f('lite-corr'), flash_ocr: f('flash-ocr'), flash_reocr: f('flash-reocr'), flash_corr: f('flash-corr'), lite_reocr2: f('lite-reocr2'), flash_reocr2: f('flash-reocr2'),
    rev_lite_ocr: rev('lite-ocr'), rev_lite_reocr: rev('lite-reocr'), rev_flash_ocr: rev('flash-ocr'), rev_flash_reocr: rev('flash-reocr') };
});
function d(ps, a, b) { const xs = ps.filter((p) => p[a] != null && p[b] != null).map((p) => p[a] - p[b]); if (!xs.length) return null; resetSeed(5700); const ci = xs.length > 1 ? bootstrapCI(xs) : null;
  return { n: xs.length, mean: r2(mean(xs)), ci: ci ? [r2(ci.lo ?? ci[0]), r2(ci.hi ?? ci[1])] : null, better: xs.filter((x) => x > 0).length, same: xs.filter((x) => x === 0).length, worse: xs.filter((x) => x < 0).length }; }
function cell(ps) {
  const lift_lite = d(ps, 'lite_reocr', 'lite_ocr'), ceil_lite = d(ps, 'lite_corr', 'lite_ocr'), lift_flash = d(ps, 'flash_reocr', 'flash_ocr'), ceil_flash = d(ps, 'flash_corr', 'flash_ocr');
  return { n: ps.length, cer_served_median: r2(100 * [...ps.map((p) => p.cer_served)].sort((a, b) => a - b)[Math.floor(ps.length / 2)]), lite_ocr: r2(mean(ps.map((p) => p.lite_ocr))), lite_reocr: r2(mean(ps.map((p) => p.lite_reocr))), lite_corr: r2(mean(ps.map((p) => p.lite_corr))),
    flash_ocr: r2(mean(ps.map((p) => p.flash_ocr))), flash_reocr: r2(mean(ps.map((p) => p.flash_reocr))), flash_corr: r2(mean(ps.map((p) => p.flash_corr))),
    lift_lite, ceil_lite, lift_flash, ceil_flash, lift_reocr_and_flash: d(ps, 'flash_reocr', 'lite_ocr'), flash_only: d(ps, 'flash_ocr', 'lite_ocr'),
    share_of_ceiling_lite: ceil_lite?.mean > 0 ? r2(lift_lite.mean / ceil_lite.mean) : null, share_of_ceiling_flash: ceil_flash?.mean > 0 ? r2(lift_flash.mean / ceil_flash.mean) : null,
    pages_le3_lite: [ps.filter((p) => p.lite_ocr <= 3).length, ps.filter((p) => p.lite_reocr <= 3).length, ps.filter((p) => p.lite_corr <= 3).length],
    reversal_rate_lite: [r2(mean(ps.map((p) => p.rev_lite_ocr))), r2(mean(ps.map((p) => p.rev_lite_reocr)))], reversal_rate_flash: [r2(mean(ps.map((p) => p.rev_flash_ocr))), r2(mean(ps.map((p) => p.rev_flash_reocr)))] };
}
const group = (key, ps = pages) => { const g = {}; for (const p of ps) (g[key(p)] ||= []).push(p); return Object.fromEntries(Object.entries(g).sort().map(([k, v]) => [k, cell(v)])); };
const aa = pages.filter((p) => p.lite_reocr2 != null);
const out = { generated: new Date().toISOString(), run_id: 'reocr-lift-2026-10', measure: 'judged against a human reference; the judge\'s source text is the by-eye corrected transcription (fidelity to the page). Not accuracy (eval-design §2).',
  judges: res.agreement, gate: { main_packet_pass: res.gate.pass, forced: res.gate.forced ?? true, note: 'main gate: wrong page 3/3, duplicate 3/3, planted 2/3 per judge. The missed plant sat in a Lite translation of a garbled manuscript read that both judges scored 1, the same as its base (nothing below 1 to score). Supplementary gate on corrected-text arms: 2/2, 2/2, 2/2 per judge (gate-supplementary.json).' },
  n_pages: pages.length, all: cell(pages), by_served_engine: group((p) => `served OCR by ${p.served_engine}`), by_script: group((p) => p.script), by_script_and_engine: group((p) => `${p.script} | served ${p.served_engine}`),
  by_cer_bin: Object.fromEntries(CER_BINS.map(([, , l]) => [l, pages.filter((p) => p.cer_bin === l)]).filter(([, v]) => v.length).map(([l, v]) => [l, cell(v)])), by_cer_bin_served_lite: Object.fromEntries(CER_BINS.map(([, , l]) => [l, pages.filter((p) => p.cer_bin === l && p.served_engine === 'lite')]).filter(([, v]) => v.length).map(([l, v]) => [l, cell(v)])),
  by_cause: group((p) => p.cause), by_manuscript: group((p) => (p.manuscript ? 'manuscript / handwritten' : 'print')), by_period_print: group((p) => p.period, pages.filter((p) => !p.manuscript)), by_track: group((p) => p.track),
  ocr_moved: { reocr_cer_better_by_1pt: cell(pages.filter((p) => p.cer_reocr - p.cer_served < -0.01)), within_1pt: cell(pages.filter((p) => Math.abs(p.cer_reocr - p.cer_served) <= 0.01)), reocr_cer_worse_by_1pt: cell(pages.filter((p) => p.cer_reocr - p.cer_served > 0.01)) },
  a_vs_a: { n: aa.length, lite: d(aa, 'lite_reocr2', 'lite_reocr'), flash: d(aa, 'flash_reocr2', 'flash_reocr'), lite_abs_mean: r2(mean(aa.map((p) => Math.abs(p.lite_reocr2 - p.lite_reocr)))), flash_abs_mean: r2(mean(aa.map((p) => Math.abs(p.flash_reocr2 - p.flash_reocr)))), lite_pages_moved_1pt: aa.filter((p) => Math.abs(p.lite_reocr2 - p.lite_reocr) >= 1).length, flash_pages_moved_1pt: aa.filter((p) => Math.abs(p.flash_reocr2 - p.flash_reocr) >= 1).length },
  pages };
fs.writeFileSync(path.join(DIR, 'lift.json'), JSON.stringify(out, null, 1));
const s = (x) => (x == null ? '—' : (x > 0 ? '+' : '') + x.toFixed(2)); const dd = (x) => (x ? `${s(x.mean)}${x.ci ? ` [${s(x.ci[0])}, ${s(x.ci[1])}]` : ''}` : '—'); const v = (x) => (x == null ? '—' : x.toFixed(2));
const table = (title, obj, first) => [`### ${title}`, '', `| ${first} | n | served CER (median) | Lite: OCR → re-read → corrected | Lite lift [95 % CI] | better/same/worse | Lite ceiling | share | Flash: OCR → re-read → corrected | Flash lift [95 % CI] | re-read + Flash vs Lite on OCR |`, '|---|---:|---:|---|---|---|---|---:|---|---|---|',
  ...Object.entries(obj).map(([k, c]) => `| ${k} | ${c.n} | ${c.cer_served_median} % | ${v(c.lite_ocr)} → ${v(c.lite_reocr)} → ${v(c.lite_corr)} | ${dd(c.lift_lite)} | ${c.lift_lite.better}/${c.lift_lite.same}/${c.lift_lite.worse} | ${dd(c.ceil_lite)} | ${c.share_of_ceiling_lite == null ? '—' : Math.round(100 * c.share_of_ceiling_lite) + ' %'} | ${v(c.flash_ocr)} → ${v(c.flash_reocr)} → ${v(c.flash_corr)} | ${dd(c.lift_flash)} | ${dd(c.lift_reocr_and_flash)} |`), ''].join('\n');
const md = [`# What a real re-read buys in translation fidelity (#5700 A5, paid pilot)`, '', `${pages.length} pages, two blind Opus judges (exact agreement ${res.agreement.fidelity_exact}, weighted κ ${res.agreement.weighted_kappa}). Fidelity 1–5 to the page (the judges' source is the by-eye corrected transcription). "Lift" = translation of a fresh gemini-3-flash-preview read minus translation of the served OCR, same translator, temperature 0. "Ceiling" = translation of the corrected text minus translation of the served OCR. Generated by \`lift.mjs\`; every page is in \`lift.json\`.`, '',
  `**A-vs-A floor** (${out.a_vs_a.n} pages, the page read twice by the same engine, each read translated): Lite ${dd(out.a_vs_a.lite)}, Flash ${dd(out.a_vs_a.flash)}; mean absolute page difference ${out.a_vs_a.lite_abs_mean} / ${out.a_vs_a.flash_abs_mean}; pages that moved a full point ${out.a_vs_a.lite_pages_moved_1pt} / ${out.a_vs_a.flash_pages_moved_1pt}.`, '',
  table('All pages', { all: out.all }, ''), table('By the engine that made the served OCR', out.by_served_engine, 'served OCR'), table('By script', out.by_script, 'script'), table('Script × served engine', out.by_script_and_engine, 'stratum'), table('By CER of the served OCR', out.by_cer_bin, 'CER bin'), table('By CER, served OCR read by Lite only', out.by_cer_bin_served_lite, 'CER bin'),
  table('By primary cause (image opened in #5695)', out.by_cause, 'cause'), table('Print vs manuscript', out.by_manuscript, ''), table('Print, by edition date', out.by_period_print, 'period'), table('By whether the fresh read is closer to the corrected text', out.ocr_moved, 'fresh read vs served, CER')].join('\n');
fs.writeFileSync(path.join(DIR, 'lift.md'), md);
const brief = (t, o) => { console.log(`\n${t}`); for (const [k, c] of Object.entries(o)) console.log(`  ${k.padEnd(40)} n ${String(c.n).padStart(2)} cer ${String(c.cer_served_median).padStart(5)}  L ${v(c.lite_ocr)}→${v(c.lite_reocr)}→${v(c.lite_corr)} lift ${dd(c.lift_lite)} ${c.lift_lite.better}/${c.lift_lite.same}/${c.lift_lite.worse} | F ${v(c.flash_ocr)}→${v(c.flash_reocr)}→${v(c.flash_corr)} lift ${dd(c.lift_flash)} | both ${dd(c.lift_reocr_and_flash)} | rev L ${c.reversal_rate_lite} F ${c.reversal_rate_flash}`); };
brief('all', { all: out.all }); brief('engine', out.by_served_engine); brief('script', out.by_script); brief('script×engine', out.by_script_and_engine); brief('cer', out.by_cer_bin); brief('cer (served lite)', out.by_cer_bin_served_lite); brief('cause', out.by_cause); brief('ms', out.by_manuscript); brief('period (print)', out.by_period_print); brief('ocr moved', out.ocr_moved);
console.log('\nA-vs-A', JSON.stringify(out.a_vs_a));
