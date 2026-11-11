#!/usr/bin/env node
// PRIOR ART: scripts/eval/latin-bakeoff-5924/score.mjs (#5924: per-arm median page CER, the paired bootstrap of the
// median per-page difference, wins/losses, catastrophic count; its shape is copied). It scores Latin views with Latin
// folds and imports repo libs; this one folds Greek (greek-ms-fit-5619.mjs foldGreekChar) and has no imports, so it
// runs as-is in the gpu-queue task on gex45.
//
// #5730 burst 2 — score the arms against the edition references, exactly as PREREGISTRATION.md fixes.
//   node score.mjs --test test.jsonl --reads <dir with F.jsonl G.jsonl L.jsonl> [--out results.json]
// Arm S (served) is test.jsonl's served_body. Missing arms are skipped and named in the output.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const TEST = arg('test', 'test.jsonl'), READS = arg('reads', 'reads'), OUT = arg('out', null);
const SEED = 5730, B = 10000, NOISE_PTS = 0.5, CATASTROPHIC = 0.5;
const ARMS = ['F', 'G', 'S', 'L'];

const VARIANT = { 'ς': 'σ', 'ϲ': 'σ', 'ϐ': 'β', 'ϑ': 'θ', 'ϕ': 'φ', 'ϖ': 'π', 'ϱ': 'ρ', 'ϰ': 'κ', 'ϒ': 'υ' };
function foldGreekChar(c) {
  const b = c.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  if (b.length !== 1) return '';
  const v = VARIANT[b] || b;
  return /[α-ω]/.test(v) ? v : '';
}
/** View N (deciding): Greek base letters only: accents, breathings, case, punctuation, spaces and non-Greek dropped. */
export const viewN = (t) => { let o = ''; for (const c of String(t || '').normalize('NFC')) o += foldGreekChar(c); return o; };
/** View A (reported): Greek letters WITH their diacritics (NFC, lowercase, final sigma folded), punctuation and spaces dropped. */
export const viewA = (t) => (String(t || '').normalize('NFC').toLowerCase().replace(/ς/g, 'σ').match(/[\p{Script=Greek}\p{M}]/gu) || []).filter((c) => !/[;·]/.test(c)).join('');

function lev(a, b) {
  const A = [...a], C = [...b]; const n = A.length, m = C.length;
  if (!n) return m; if (!m) return n;
  let prev = new Uint32Array(m + 1), cur = new Uint32Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i; const ai = A[i - 1];
    for (let j = 1; j <= m; j++) { const x = prev[j - 1] + (ai === C[j - 1] ? 0 : 1), y = prev[j] + 1, z = cur[j - 1] + 1; cur[j] = x < y ? (x < z ? x : z) : (y < z ? y : z); }
    [prev, cur] = [cur, prev];
  }
  return prev[m];
}
const cer = (ref, hyp) => (ref.length ? lev(ref, hyp) / ref.length : null);
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const k = s.length >> 1; return s.length ? (s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2) : null; };
let state = SEED >>> 0; const rnd = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
function bootMedianCI(xs) {
  if (xs.length < 2) return null; state = SEED >>> 0; const meds = new Float64Array(B);
  for (let b = 0; b < B; b++) { const s = new Array(xs.length); for (let j = 0; j < xs.length; j++) s[j] = xs[Math.floor(rnd() * xs.length)]; meds[b] = median(s); }
  meds.sort(); return [meds[Math.floor(B * 0.025)], meds[Math.floor(B * 0.975)]];
}
const r4 = (x) => (x == null ? null : Math.round(x * 10000) / 10000);
const readJsonl = (f) => {
  if (!fs.existsSync(f) && fs.existsSync(f + '.gz')) return zlib.gunzipSync(fs.readFileSync(f + '.gz')).toString().split('\n').filter(Boolean).map(JSON.parse);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : null;
};

const test = readJsonl(TEST);
const texts = { S: Object.fromEntries(test.map((r) => [r.id, r.served_body || ''])) };
const runs = {};
for (const a of ['F', 'G', 'L']) {
  const rows = readJsonl(path.join(READS, `${a}.jsonl`)); if (!rows) continue;
  texts[a] = Object.fromEntries(rows.filter((r) => !r.error).map((r) => [r.page_id, r.text || '']));
  try { runs[a] = JSON.parse(fs.readFileSync(path.join(READS, `${a}.jsonl.run.json`), 'utf8')); } catch { /* optional */ }
}
const arms = ARMS.filter((a) => texts[a]);
// A page counts only if every present arm read it (the same pages for every comparison).
const pages = test.filter((r) => arms.every((a) => r.id in texts[a])).map((r) => {
  const RN = viewN(r.text), RA = viewA(r.text);
  return { id: r.id, set: r.set, book: r.book_name, ref_letters: RN.length, arms: Object.fromEntries(arms.map((a) => [a, { N: cer(RN, viewN(texts[a][r.id])), A: cer(RA, viewA(texts[a][r.id])), letters: viewN(texts[a][r.id]).length }])) };
});

function block(P) {
  const out = { n: P.length };
  for (const a of arms) {
    const xs = P.map((p) => p.arms[a].N);
    out[a] = { median_N: r4(median(xs)), ci_N: bootMedianCI(xs)?.map(r4), median_A: r4(median(P.map((p) => p.arms[a].A))), catastrophic: xs.filter((x) => x > CATASTROPHIC).length };
  }
  for (const a of ['F', 'G']) for (const b of ['S', 'L', 'G']) {
    if (a === b || !texts[a] || !texts[b] || (a === 'G' && b === 'G')) continue;
    const d = P.map((p) => p.arms[a].N - p.arms[b].N);
    out[`${a}-${b}`] = { median_d: r4(median(d)), ci: bootMedianCI(d)?.map(r4), wins: d.filter((x) => x < 0).length, losses: d.filter((x) => x > 0).length };
  }
  return out;
}

// The preregistered rule, on T2 (decides) and T1 (reported: near-distribution only).
function verdict(b) {
  if (!b.F || !b.S || !b.L || !b.G) return { pass: null, why: 'an arm is missing' };
  const beats = (k) => b[k].ci && b[k].ci[1] < 0 && Math.abs(b[k].median_d) * 100 >= NOISE_PTS;
  const checks = {
    'F beats S (CI < 0, |Δ| ≥ 0.5 pt)': beats('F-S'),
    'F beats L (CI < 0, |Δ| ≥ 0.5 pt)': beats('F-L'),
    'F catastrophic ≤ S + 1': b.F.catastrophic <= b.S.catastrophic + 1,
    'F median < G median': b.F.median_N < b.G.median_N,
  };
  return { pass: Object.values(checks).every(Boolean), checks };
}

const res = { at: new Date().toISOString(), arms, runs, rule: { noise_pts: NOISE_PTS, catastrophic_cer: CATASTROPHIC, B, seed: SEED }, dropped: test.length - pages.length, sets: {} };
for (const s of ['T2', 'T1']) {
  const P = pages.filter((p) => p.set === s); if (!P.length) continue;
  res.sets[s] = { all: block(P), by_book: Object.fromEntries([...new Set(P.map((p) => p.book))].map((bk) => [bk, block(P.filter((p) => p.book === bk))])) };
  res.sets[s].verdict = verdict(res.sets[s].all);
}
res.overall = res.sets.T2?.verdict?.pass == null ? 'INCOMPLETE'
  : res.sets.T2.verdict.pass ? 'PASS (library shift): a Greek-manuscript lane candidate'
  : res.sets.T1?.verdict?.pass ? 'FAIL on the library shift; passes on Grec 1841 only (near distribution): not a lane'
  : 'FAIL';

const pct = (x) => (x == null ? '—' : (x * 100).toFixed(1));
const lines = [`overall: ${res.overall}`, `arms: ${arms.join(' ')}; pages scored ${pages.length}, dropped ${res.dropped} (an arm had no read)`];
for (const [s, v] of Object.entries(res.sets)) {
  lines.push('', `== ${s} (n = ${v.all.n})  median page CER %, view N [95% CI]  | view A | catastrophic`);
  for (const a of arms) lines.push(`  ${a}: ${pct(v.all[a].median_N)} [${v.all[a].ci_N?.map(pct).join(', ')}] | ${pct(v.all[a].median_A)} | ${v.all[a].catastrophic}`);
  for (const k of Object.keys(v.all).filter((x) => x.includes('-'))) lines.push(`  ${k}: Δ ${pct(v.all[k].median_d)} pt [${v.all[k].ci?.map(pct).join(', ')}]  W/L ${v.all[k].wins}/${v.all[k].losses}`);
  for (const [bk, bb] of Object.entries(v.by_book)) lines.push(`  · ${bk} (n ${bb.n}): ${arms.map((a) => `${a} ${pct(bb[a].median_N)}`).join('  ')}`);
  lines.push(`  verdict: ${v.verdict.pass} ${JSON.stringify(v.verdict.checks || v.verdict.why)}`);
}
console.log(lines.join('\n'));
if (OUT) {
  fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
  fs.writeFileSync(OUT.replace(/\.json$/, '') + '-pages.json.gz', zlib.gzipSync(JSON.stringify(pages)));
}
