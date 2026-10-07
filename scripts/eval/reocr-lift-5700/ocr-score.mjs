#!/usr/bin/env node
// PRIOR ART: scripts/eval/benchmark-score.mjs scores an engine against PINNED passage references (free-skip
// aligner); scripts/eval/two-read-garble-5313.mjs scores agreement between two reads with no reference. Here the
// reference is the #5695 tracks' by-eye corrected transcription of the same page, so the served read and the fresh
// read are scored on the same pages with the same plain edit distance (text-distance.mjs).
/** #5700 A5: does a fresh flash-preview read get closer to the by-eye corrected transcription than the served OCR, per script and per served engine? */
/**
 *   node scripts/eval/reocr-lift-5700/ocr-score.mjs [--dir scripts/eval/results/reocr-lift-2026-10]
 * Reads track-pages.jsonl, enriched.jsonl, reocr.jsonl. Writes ocr-score.json. No network.
 * measure: distance to a by-eye correction of the SERVED OCR. The corrector started from the served text, so
 * wherever it left a doubtful reading alone the served OCR scores as right and a different fresh read as wrong:
 * the comparison is biased toward the served OCR. Not accuracy (eval-design §2).
 */
import fs from 'node:fs';
import path from 'node:path';
import { errorRates, wordOverlap } from './text-distance.mjs';
import { SCRIPT_GROUP } from './text-distance.mjs';
import { bootstrapCI, resetSeed, mean } from '../lib/paired-stats.mjs';

const args = process.argv.slice(2);
const DIR = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : 'scripts/eval/results/reocr-lift-2026-10';
const rl = (f) => fs.readFileSync(path.join(DIR, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const r3 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);
const med = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? r3(s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const enriched = Object.fromEntries(rl('enriched.jsonl').map((e) => [e.id, e]));
const reads = {}; for (const r of rl('reocr.jsonl')) (reads[r.arm] ||= {})[r.id] = r;
const engine = (m) => (/lite/.test(m || '') ? 'lite' : /flash/.test(m || '') ? 'flash' : 'other');

const pages = rl('track-pages.jsonl').map((r) => {
  const a = reads.reocr?.[r.id], b = reads.reocr2?.[r.id]; const e = enriched[r.id];
  const row = { id: r.id, track: r.track, lang: r.lang, script: SCRIPT_GROUP[r.lang], stratum: r.stratum, has_corrected: r.has_corrected, primary_cause: r.primary_cause,
    served_ocr_model: e.served_ocr.model, served_engine: engine(e.served_ocr.model), served_ocr_prompt: e.served_ocr.prompt_version, reocr_outcome: a?.outcome ?? 'missing' };
  const disp = reads['reocr-display']?.[r.id];
  if (a?.outcome === 'text') { row.change_vs_served = r3(errorRates(a.text, r.ocr_text).cer); row.served_words_in_reocr = r3(wordOverlap(r.ocr_text, a.text)); }
  if (disp?.outcome === 'text' && a?.outcome === 'text') row.reocr_words_in_display_read = r3(wordOverlap(a.text, disp.text));
  if (r.has_corrected) {
    const es = errorRates(r.ocr_text, r.corrected_text); row.cer_served = r3(es.cer); row.miss_served = r3(es.miss);
    if (a?.outcome === 'text') { const ea = errorRates(a.text, r.corrected_text); row.cer_reocr = r3(ea.cer); row.miss_reocr = r3(ea.miss); row.cer_delta = r3(row.cer_reocr - row.cer_served); row.miss_delta = r3(row.miss_reocr - row.miss_served); }
    if (b?.outcome === 'text') { row.cer_reocr2 = r3(errorRates(b.text, r.corrected_text).cer); if (a?.outcome === 'text') row.aa_distance = r3(errorRates(b.text, a.text).cer); }
    // The served OCR (and so its corrected text) is another leaf than the image: the fresh read shares almost no words
    // with it, a second read from the displayed image agrees with the fresh read, and the served text was "clean".
    row.different_leaf = row.served_words_in_reocr != null && row.served_words_in_reocr < 0.2 && (row.reocr_words_in_display_read ?? 0) >= 0.9 && row.cer_served < 0.2;
  }
  return row;
});

function cell(ps) {
  resetSeed(5700); const both = ps.filter((p) => p.cer_reocr != null); const d = both.map((p) => p.cer_delta);
  const ci = d.length > 1 ? bootstrapCI(d) : null; const eps = 0.01;
  return { n: ps.length, read_ok: both.length, not_read: ps.filter((p) => p.has_corrected && p.cer_reocr == null).length,
    cer_served_median: med(both.map((p) => p.cer_served)), cer_reocr_median: med(both.map((p) => p.cer_reocr)), cer_served_mean: r3(mean(both.map((p) => p.cer_served))), cer_reocr_mean: r3(mean(both.map((p) => p.cer_reocr))),
    miss_served_median: med(both.map((p) => p.miss_served)), miss_reocr_median: med(both.map((p) => p.miss_reocr)), miss_mean_delta: r3(mean(both.map((p) => p.miss_delta))), miss_better: both.filter((p) => p.miss_delta < -0.01).length, miss_worse: both.filter((p) => p.miss_delta > 0.01).length,
    mean_delta: d.length ? r3(mean(d)) : null, mean_delta_ci: ci ? [r3(ci.lo ?? ci[0]), r3(ci.hi ?? ci[1])] : null,
    better: both.filter((p) => p.cer_delta < -eps).length, same_within_1pt: both.filter((p) => Math.abs(p.cer_delta) <= eps).length, worse: both.filter((p) => p.cer_delta > eps).length,
    served_at_or_over_5pct: both.filter((p) => p.cer_served >= 0.05).length, of_those_reocr_under_5pct: both.filter((p) => p.cer_served >= 0.05 && p.cer_reocr < 0.05).length,
    of_those_reocr_halved: both.filter((p) => p.cer_served >= 0.05 && p.cer_reocr <= p.cer_served / 2).length };
}
const corr = pages.filter((p) => p.has_corrected && !p.different_leaf);
const group = (ps, key) => { const g = {}; for (const p of ps) (g[key(p)] ||= []).push(p); return Object.fromEntries(Object.entries(g).sort().map(([k, v]) => [k, cell(v)])); };
const aa = corr.filter((p) => p.aa_distance != null);
const out = { generated: new Date().toISOString(), engine: 'gemini-3-flash-preview, production OCR prompt v19.1, realtime', measure: 'CER against the by-eye corrected transcription of the served OCR (biased toward the served OCR; see header)',
  different_leaf: pages.filter((p) => p.different_leaf).map((p) => ({ id: p.id, lang: p.lang, served_words_in_reocr: p.served_words_in_reocr, reocr_words_in_display_read: p.reocr_words_in_display_read })),
  outcomes: pages.reduce((o, p) => { o[p.reocr_outcome] = (o[p.reocr_outcome] || 0) + 1; return o; }, {}), not_read: pages.filter((p) => p.reocr_outcome !== 'text').map((p) => ({ id: p.id, lang: p.lang, outcome: p.reocr_outcome })),
  all: cell(corr), by_served_engine: group(corr, (p) => p.served_engine), by_script: group(corr, (p) => p.script), by_script_and_served_engine: group(corr, (p) => `${p.script} | served ${p.served_engine}`),
  by_track: group(corr, (p) => p.track), by_cause: group(corr, (p) => p.primary_cause ?? 'not classified'),
  a_vs_a: { n: aa.length, note: 'the same request twice on 30 seeded pages (temperature 0.1)', distance_between_reads_median: med(aa.map((p) => p.aa_distance)), distance_between_reads_mean: r3(mean(aa.map((p) => p.aa_distance))),
    cer_gap_between_reads_mean_abs: r3(mean(aa.map((p) => Math.abs(p.cer_reocr2 - p.cer_reocr)))), cer_gap_p90: r3(aa.map((p) => Math.abs(p.cer_reocr2 - p.cer_reocr)).sort((a, b) => a - b)[Math.floor(aa.length * 0.9)]),
    pages_over_1pt: aa.filter((p) => Math.abs(p.cer_reocr2 - p.cer_reocr) > 0.01).length, pages_over_5pt: aa.filter((p) => Math.abs(p.cer_reocr2 - p.cer_reocr) > 0.05).length },
  change_vs_served: { note: 'distance of the fresh read from the served OCR, all 109 pages incl. the 10 low pages with no corrected text', median: med(pages.map((p) => p.change_vs_served)), over_5pct: pages.filter((p) => p.change_vs_served > 0.05).length, over_20pct: pages.filter((p) => p.change_vs_served > 0.2).length, n: pages.filter((p) => p.change_vs_served != null).length },
  pages };
fs.writeFileSync(path.join(DIR, 'ocr-score.json'), JSON.stringify(out, null, 1));
const pc = (x) => (x == null ? '—' : (100 * x).toFixed(1));
const show = (t, o) => { console.log(`\n${t}`); for (const [k, c] of Object.entries(o)) console.log(`  ${k.padEnd(44)} n ${String(c.read_ok).padStart(3)}  served ${pc(c.cer_served_median).padStart(5)} → reocr ${pc(c.cer_reocr_median).padStart(5)} (median %)  mean ${pc(c.cer_served_mean)} → ${pc(c.cer_reocr_mean)}  Δ ${pc(c.mean_delta)} ${c.mean_delta_ci ? `[${pc(c.mean_delta_ci[0])}, ${pc(c.mean_delta_ci[1])}]` : ''}  better/same/worse ${c.better}/${c.same_within_1pt}/${c.worse} | miss ${pc(c.miss_served_median)} → ${pc(c.miss_reocr_median)} Δ ${pc(c.miss_mean_delta)} b/w ${c.miss_better}/${c.miss_worse} |  ≥5%: ${c.served_at_or_over_5pct} → fixed ${c.of_those_reocr_under_5pct}, halved ${c.of_those_reocr_halved}`); };
console.log('outcomes', out.outcomes, out.not_read.map((x) => x.id + ' ' + x.outcome).join('; '), '\ndifferent leaf', out.different_leaf); show('all', { all: out.all }); show('by served engine', out.by_served_engine); show('by script', out.by_script); show('script × served engine', out.by_script_and_served_engine); show('by cause', out.by_cause);
console.log('\nA-vs-A', out.a_vs_a); console.log('change vs served', out.change_vs_served);
