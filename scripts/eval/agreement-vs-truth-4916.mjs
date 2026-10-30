#!/usr/bin/env node
/**
 * Does agreement between two OCR reads of a page predict its error against a published reference? (#4916)
 *
 * PRIOR ART: scripts/eval/two-read-garble-5313.mjs — scores disagreement against a model JUDGE's label on
 * served pages; this scores it against a published REFERENCE on the sealed benchmark's reference tiers.
 * scripts/eval/benchmark-score.mjs — produces the per-page reference CER read here; it has no agreement
 * between engines on the reference tiers.
 *
 * No API calls. Inputs:
 *   --outputs=<engine-outputs.jsonl>  the sealed Sept-2026 benchmark's raw transcripts (one row per stratum,
 *                                     engine, page). Copy: sidequests/ocr-quality-paper/data/ocr-benchmark-2026-09/
 *   scripts/eval/results/benchmark/{ref-ws,ref-pinned}-2026-09-16.json  per-page reference CER (aligned pages only)
 *   --out=<dir>                       where the report and the per-page rows go
 *
 * Disagreement = letter-level Levenshtein between the two engines' WHOLE-PAGE outputs, normalised as
 * benchmark-score.mjs normAlpha does, over their mean length. Error = Flash-Lite's reference CER (the
 * served engine). Chinese is left out: its CBETA references are e-text windows longer than the page, so
 * its CER measures window fit, not reading (checked on chinese-15f73d-p10, 2026-10-30).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { levenshtein } from './lib/metrics.mjs';
import { stripMarkupTags } from '../lib/strip-markup-tags.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const OUTPUTS = argOf('outputs');
const OUT = argOf('out');
if (!OUTPUTS || !OUT) { console.error('usage: --outputs=<engine-outputs.jsonl> --out=<dir>'); process.exit(1); }

const A = 'gemini-3-flash-preview', B = 'gemini-3.1-flash-lite';
const STRATA = ['ref-ws', 'ref-pinned'];
const AGREE = 0.02, BAD = 0.05, CAP = 6000;
// Pages whose reference, not the OCR, carries the error — read by diff on 2026-10-30. Reported both ways.
const REFERENCE_FAULT = {
  'ws-la-athanasius-kircher-turris-babel-1679-djvu-p20': 'reference is wiki table markup (style=, |-)',
  'ws-la-gauss-carl-friedrich-werke-1870-djvu-p21': 'reference writes congruence as LaTeX \\equiv',
};

const normAlpha = s => stripMarkupTags(String(s || '')
  .replace(/<(warning|meta|image-desc|figure|note|scan-quality|language|page-type|columns|detected-images|vocab)\b[^>]*>[\s\S]*?<\/\1>/gi, ' '))
  .replace(/```[a-z]*/g, ' ').normalize('NFC').toLowerCase().replace(/ſ/g, 's')
  .replace(/(\p{L})[-‐‑¬]\s*\n\s*/gu, '$1').replace(/[^\p{L}\p{N}]+/gu, '');

const texts = new Map();
for (const line of fs.readFileSync(OUTPUTS, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  if (!STRATA.includes(r.stratum) || (r.engine !== A && r.engine !== B)) continue;
  const k = `${r.stratum}|${r.slug}`;
  (texts.get(k) || texts.set(k, {}).get(k))[r.engine] = r.text || '';
}

const rows = [];
const skipped = { not_aligned: 0, missing_output: 0, under_100_letters: 0 };
for (const st of STRATA) {
  const res = JSON.parse(fs.readFileSync(path.join(__dirname, 'results', 'benchmark', `${st}-2026-09-16.json`), 'utf8'));
  for (const p of res.pages) {
    const ea = p.engines[A], eb = p.engines[B], t = texts.get(`${st}|${p.slug}`);
    if (!ea || !eb || ea.missing || eb.missing || !t || t[A] == null || t[B] == null) { skipped.missing_output++; continue; }
    if (!ea.aligned || !eb.aligned || ea.cer == null || eb.cer == null) { skipped.not_aligned++; continue; }
    const na = normAlpha(t[A]).slice(0, CAP), nb = normAlpha(t[B]).slice(0, CAP);
    const len = (na.length + nb.length) / 2;
    if (len < 100) { skipped.under_100_letters++; continue; }
    rows.push({ stratum: st, slug: p.slug, language: p.language, script: p.script,
      disagree: +(levenshtein([...na], [...nb]) / len).toFixed(4), cer_flash: ea.cer, cer_lite: eb.cer,
      reference_fault: REFERENCE_FAULT[p.slug] || null });
  }
}

const rank = xs => { const o = xs.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = Array(xs.length);
  for (let i = 0; i < o.length;) { let j = i; while (j + 1 < o.length && o[j + 1][0] === o[i][0]) j++; for (let k = i; k <= j; k++) r[o[k][1]] = (i + j) / 2; i = j + 1; } return r; };
const pearson = (x, y) => { const n = x.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sx = 0, sy = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sx += (x[i] - mx) ** 2; sy += (y[i] - my) ** 2; } return sxy / Math.sqrt(sx * sy); };
const spearman = (x, y) => pearson(rank(x), rank(y));
const auc = (s, l) => { let n = 0, v = 0; for (let i = 0; i < s.length; i++) if (l[i]) for (let j = 0; j < s.length; j++) if (!l[j]) { n++; v += s[i] > s[j] ? 1 : s[i] === s[j] ? 0.5 : 0; } return n ? v / n : null; };
const wilson = (k, n) => { if (!n) return null; const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [+((c - m) / d).toFixed(3), +((c + m) / d).toFixed(3)]; };
let seed = 4916; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const bootAuc = (s, l, B = 2000) => { const v = []; for (let b = 0; b < B; b++) { const idx = s.map(() => Math.floor(rnd() * s.length)); const ls = idx.map(i => l[i]);
  if (ls.some(Boolean) && !ls.every(Boolean)) v.push(auc(idx.map(i => s[i]), ls)); } v.sort((a, b) => a - b); return [+v[Math.floor(0.025 * v.length)].toFixed(3), +v[Math.floor(0.975 * v.length)].toFixed(3)]; };

function summarise(rs) {
  const d = rs.map(r => r.disagree), c = rs.map(r => r.cer_lite), bad = c.map(x => x > BAD);
  const nBad = bad.filter(Boolean).length;
  const agree = rs.filter(r => r.disagree <= AGREE), agreeBad = agree.filter(r => r.cer_lite > BAD);
  const apart = rs.filter(r => r.disagree > AGREE), apartBad = apart.filter(r => r.cer_lite > BAD);
  const out = { n: rs.length, n_bad: nBad, spearman: +spearman(d, c).toFixed(3) };
  if (nBad && nBad < rs.length) { out.auc = +auc(d, bad).toFixed(3); if (rs.length >= 30) out.auc_ci95 = bootAuc(d, bad); }
  out.agree = { n: agree.length, bad: agreeBad.length, rate_ci95: wilson(agreeBad.length, agree.length), slugs: agreeBad.map(r => r.slug) };
  out.apart = { n: apart.length, bad: apartBad.length, rate_ci95: wilson(apartBad.length, apart.length) };
  out.bad_pages_flagged = `${apartBad.length}/${nBad}`;
  return out;
}
const byLang = {}; for (const r of rows) (byLang[r.language] ||= []).push(r);
const report = {
  date: new Date().toISOString().slice(0, 10), issue: 4916, pair: [A, B], strata: STRATA,
  definitions: { disagree: 'whole-page letter Levenshtein between the two reads / mean length', bad: `Flash-Lite reference CER > ${BAD}`, agree: `disagree <= ${AGREE}` },
  skipped, reference_fault: REFERENCE_FAULT,
  all: summarise(rows),
  without_reference_faults: summarise(rows.filter(r => !r.reference_fault)),
  by_language: Object.fromEntries(Object.entries(byLang).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => [k, summarise(v)])),
};
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(path.join(OUT, 'pages.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
const s = report.all, w = report.without_reference_faults;
console.log(`n=${s.n} bad=${s.n_bad} rho=${s.spearman} AUC=${s.auc} ${JSON.stringify(s.auc_ci95)} | agree: ${s.agree.bad}/${s.agree.n} bad | apart: ${s.apart.bad}/${s.apart.n} bad | flagged ${s.bad_pages_flagged}`);
console.log(`without reference faults: n=${w.n} AUC=${w.auc} ${JSON.stringify(w.auc_ci95)} | agree: ${w.agree.bad}/${w.agree.n} ${JSON.stringify(w.agree.rate_ci95)} | flagged ${w.bad_pages_flagged}`);
for (const [k, v] of Object.entries(report.by_language)) console.log(`  ${k}: n=${v.n} bad=${v.n_bad} rho=${v.spearman} auc=${v.auc ?? '-'} agree-but-bad ${v.agree.bad}/${v.agree.n}`);
