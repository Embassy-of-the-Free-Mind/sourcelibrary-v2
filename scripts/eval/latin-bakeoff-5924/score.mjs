#!/usr/bin/env node
// PRIOR ART: scripts/eval/latin-r4-report-5924.mjs (latin-norm@1: foldDeterministic / foldGuided imported unchanged;
// its report is book-level over 3-page runs scored by benchmark-score.mjs, with no order tolerance and no diplomatic
// view); scripts/eval/zh-residue-bakeoff-6871/score.py (the per-class median / paired bootstrap / noise-floor shape,
// for Han strings). This scores the #5924 Latin leaf references with the rules of prereg Amendment 4.
/**
 * score.mjs — the #5924 GEX45 Latin bake-off scorer (PREREGISTRATION-open-engine-print-5660.md, Amendment 4).
 *
 *   node score.mjs <arms dir> [--out results.json] [--self-test]
 * <arms dir>/<ARM>.jsonl(.gz): rows {page_id | uid, text, finish?, raw?}. The last row per page wins. A page with no
 * row, an error row or empty text scores CER 1.0.
 * Views: N (primary: latin-norm@1, then marks dropped, lower case, ſ→s v→u j→i, letters only) and D (diplomatic:
 * NFC, lower case, letters + marks + & ⁊). Deciding CER = N on the order-tolerant (segment-reordered) engine text.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { foldDeterministic, foldGuided } from '../latin-r4-report-5924.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.join(HERE, '..', 'benchmark');
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : null; };
const LITE = 'L', NOISE = ['L1a', 'L1b'];
const OPEN = ['P0', 'P1', 'M', 'G', 'O', 'K'];
const BASE_EXTRA = ['F'];
const SEED = 5924, B = 10000;

// ── text views ───────────────────────────────────────────────────────────────
export function clean(t) {
  let s = String(t || '').replace(/<<<(BEGIN|END)>>>/g, '\n');
  s = s.replace(/^﻿?---\n[\s\S]*?\n---\n/, '');                // olmOCR front matter
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '\n').replace(/<[^>\n]{1,200}>/g, '\n');   // image links, HTML tags
  return s.replace(/^\s{0,3}#{1,6}\s+/gm, '').replace(/\*\*|__/g, '');
}
const nview = (s) => (s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/ſ/g, 's').replace(/v/g, 'u').replace(/j/g, 'i').match(/\p{L}/gu) || []).join('');
const dview = (s) => (s.normalize('NFC').toLowerCase().match(/[\p{L}\p{M}&⁊]/gu) || []).join('');

/** {N, D} strings of the reference, and of an engine text (plain and reordered). */
export function views(refRaw, hypRaw) {
  const refF = foldDeterministic(refRaw);
  const R = { N: nview(refF), D: dview(refRaw) };
  const h = clean(hypRaw);
  const hF = foldGuided(foldDeterministic(h), refF).text;
  const linesN = hF.split('\n').map(nview), linesD = h.split('\n').map(dview);
  if (linesN.length !== linesD.length) throw new Error('fold changed the line count');
  const order = reorder(R.N, linesN);
  return { R, H: { N: linesN.join(''), D: linesD.join(''), Nr: order.map((i) => linesN[i]).join(''), Dr: order.map((i) => linesD[i]).join('') }, moved: order.some((v, i) => v !== i) };
}

/** Order tolerance: each line goes to the reference offset where most of its 6-grams fall; no hit = after the line before. */
export function reorder(ref, lines, K = 6) {
  const idx = new Map();
  for (let p = 0; p + K <= ref.length; p++) { const g = ref.slice(p, p + K); const a = idx.get(g); if (a) a.push(p); else idx.set(g, [p]); }
  // An offset with at least half the top vote count is a candidate; the one nearest the cursor (where this line would
  // start if the text ran in order) wins, so a repeated phrase never pulls a line out of order.
  let prev = -1, cursor = 0; const keys = [];
  lines.forEach((s, li) => {
    const votes = new Map();
    for (let i = 0; i + K <= s.length; i++) {
      const ps = idx.get(s.slice(i, i + K)); if (!ps || ps.length > 5) continue;
      for (const p of ps) votes.set(p - i, (votes.get(p - i) || 0) + 1);
    }
    let bv = 0; for (const v of votes.values()) if (v > bv) bv = v;
    let best = null;
    for (const [o, v] of votes) if (v * 2 >= bv && (best == null || Math.abs(o - cursor) < Math.abs(best - cursor) || (Math.abs(o - cursor) === Math.abs(best - cursor) && o < best))) best = o;
    const key = best == null ? prev : best;
    keys.push([key, li]); prev = key; cursor = (best == null ? cursor : best) + s.length;
  });
  return keys.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((k) => k[1]);
}

export function lev(a, b) {
  const A = [...a], Bc = [...b]; const n = A.length, m = Bc.length;
  if (!n) return m; if (!m) return n;
  let prev = new Uint32Array(m + 1), cur = new Uint32Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i; const ai = A[i - 1];
    for (let j = 1; j <= m; j++) { const d = prev[j - 1] + (ai === Bc[j - 1] ? 0 : 1); const x = prev[j] + 1, y = cur[j - 1] + 1; cur[j] = d < x ? (d < y ? d : y) : (x < y ? x : y); }
    [prev, cur] = [cur, prev];
  }
  return prev[m];
}
const cer = (r, h) => (r.length ? Math.min(1, lev(r, h) / [...r].length) : (h.length ? 1 : 0));

/** ſ outcomes on the D alignment (reference ſ read as f / s / ſ / other or deleted; reference f read as ſ). */
export function longS(ref, hyp) {
  const A = [...ref], H = [...hyp].slice(0, 2 * A.length + 100); const n = A.length, m = H.length;
  const out = { ref_long_s: A.filter((c) => c === 'ſ').length, s_as_f: 0, s_as_s: 0, s_kept: 0, f_as_long_s: 0, aligned: true };
  if (!n || (n + 1) * (m + 1) > 6e7) { out.aligned = false; return out; }
  const W = m + 1, D = new Uint16Array((n + 1) * W);
  for (let j = 0; j <= m; j++) D[j] = j;
  for (let i = 1; i <= n; i++) {
    D[i * W] = i;
    for (let j = 1; j <= m; j++) D[i * W + j] = Math.min(D[(i - 1) * W + j - 1] + (A[i - 1] === H[j - 1] ? 0 : 1), D[(i - 1) * W + j] + 1, D[i * W + j - 1] + 1);
  }
  let i = n, j = m;
  while (i > 0 && j > 0) {
    if (D[i * W + j] === D[(i - 1) * W + j - 1] + (A[i - 1] === H[j - 1] ? 0 : 1)) {
      if (A[i - 1] === 'ſ') { if (H[j - 1] === 'f') out.s_as_f++; else if (H[j - 1] === 's') out.s_as_s++; else if (H[j - 1] === 'ſ') out.s_kept++; }
      if (A[i - 1] === 'f' && H[j - 1] === 'ſ') out.f_as_long_s++;
      i--; j--;
    } else if (D[i * W + j] === D[(i - 1) * W + j] + 1) i--; else j--;
  }
  return out;
}

// ── stats ────────────────────────────────────────────────────────────────────
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const k = s.length >> 1; return s.length ? (s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2) : null; };
function bootCI(xs) {
  if (xs.length < 2) return null; const rnd = mulberry32(SEED); const meds = new Float64Array(B);
  for (let b = 0; b < B; b++) { const s = new Array(xs.length); for (let j = 0; j < xs.length; j++) s[j] = xs[Math.floor(rnd() * xs.length)]; meds[b] = median(s); }
  meds.sort(); return [meds[Math.floor(B * 0.025)], meds[Math.floor(B * 0.975) - 1]];
}
const r4 = (x) => (x == null ? null : Math.round(x * 10000) / 10000);

// ── load ─────────────────────────────────────────────────────────────────────
function loadArm(file) {
  const raw = file.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(file)).toString('utf8') : fs.readFileSync(file, 'utf8');
  const rows = {};
  for (const l of raw.split('\n')) {
    if (!l.trim()) continue; const r = JSON.parse(l); const id = r.page_id || r.uid;
    let text = r.text; if ((!text || !String(text).trim()) && r.raw) text = r.raw;
    rows[id] = { text: r.error && !text ? '' : String(text || ''), finish: r.finish || null, error: r.error || null };
  }
  return rows;
}

function selfTest() {
  const ref = 'Ille quātum ſoluat\nproportio arithmetica\nMarg. note';
  const v = views(ref, 'Marg. note\nIlle quantum soluat\nproportio arithmetica');
  console.assert(cer(v.R.N, v.H.Nr) === 0, 'reordered N should be 0', v);
  console.assert(cer(v.R.N, v.H.N) > 0, 'plain N should be > 0');
  const ls = longS(dview('ſoluat ſic'), dview('foluat sic')); console.assert(ls.s_as_f === 1 && ls.s_as_s === 1, ls);
  console.log('self-test ok', { plainN: r4(cer(v.R.N, v.H.N)), reorderedN: cer(v.R.N, v.H.Nr), D: r4(cer(v.R.D, v.H.Dr)) });
}

// ── main ─────────────────────────────────────────────────────────────────────
function main() {
  if (args.includes('--self-test')) return selfTest();
  const dir = args[0];
  const manifest = JSON.parse(fs.readFileSync(path.join(BENCH, 'latin-refs-5924.json'), 'utf8')).pages;
  const arms = {};
  for (const f of fs.readdirSync(dir).filter((x) => /^[A-Za-z0-9]+\.jsonl(\.gz)?$/.test(x))) arms[f.split('.')[0]] = loadArm(path.join(dir, f));
  const pages = [];
  for (const p of manifest) {
    const refRaw = fs.readFileSync(path.join(BENCH, 'refs', `${p.slug}.txt`), 'utf8');
    const row = { slug: p.slug, century: p.substratum, typeface: p.typeface, arms: {} };
    for (const [a, rows] of Object.entries(arms)) {
      const r = rows[p.slug]; const text = r ? r.text : '';
      if (!text.trim()) { row.arms[a] = { N: 1, D: 1, Nplain: 1, Dplain: 1, empty: true, catastrophic: true, cap: false, hyp_letters: 0, ref_letters: nview(foldDeterministic(refRaw)).length, longS: longS(dview(refRaw), '') }; continue; }
      const v = views(refRaw, text);
      const N = cer(v.R.N, v.H.Nr);
      row.arms[a] = {
        N: r4(N), D: r4(cer(v.R.D, v.H.Dr)), Nplain: r4(cer(v.R.N, v.H.N)), Dplain: r4(cer(v.R.D, v.H.D)), moved: v.moved,
        ref_letters: v.R.N.length, hyp_letters: v.H.N.length, empty: false,
        loop: v.H.N.length > 2 * v.R.N.length, catastrophic: N > 0.5 || v.H.N.length > 2 * v.R.N.length,
        cap: ['length', 'MAX_TOKENS'].includes(r.finish), longS: longS(v.R.D, v.H.Dr),
      };
    }
    pages.push(row);
  }
  const res = { prereg: 'PREREGISTRATION-open-engine-print-5660.md Amendment 4', seed: SEED, resamples: B, arms: Object.keys(arms).sort(), cells: {} };
  for (const cent of ['1600s', '1500s', 'all']) {
    const P = pages.filter((p) => cent === 'all' || p.century === cent); const c = { n: P.length, arms: {} };
    const noise = NOISE.every((a) => arms[a]) ? median(P.map((p) => Math.abs(p.arms[NOISE[0]].N - p.arms[NOISE[1]].N))) : null;
    const noiseD = NOISE.every((a) => arms[a]) ? median(P.map((p) => Math.abs(p.arms[NOISE[0]].D - p.arms[NOISE[1]].D))) : null;
    c.noise_floor_N = r4(noise); c.noise_floor_D = r4(noiseD);
    const liteCat = arms[LITE] ? P.filter((p) => p.arms[LITE].catastrophic).length : null;
    for (const a of res.arms) {
      const xs = P.map((p) => p.arms[a].N), ds = P.map((p) => p.arms[a].D);
      const s = { median_N: r4(median(xs)), ci_N: bootCI(xs)?.map(r4), median_D: r4(median(ds)), ci_D: bootCI(ds)?.map(r4),
        median_N_plain: r4(median(P.map((p) => p.arms[a].Nplain))), median_D_plain: r4(median(P.map((p) => p.arms[a].Dplain))),
        catastrophic: P.filter((p) => p.arms[a].catastrophic).length, loops: P.filter((p) => p.arms[a].loop).length,
        empty: P.filter((p) => p.arms[a].empty).length, cap: P.filter((p) => p.arms[a].cap).length,
        reordered_pages: P.filter((p) => p.arms[a].moved).length, longS: {} };
      for (const k of ['ref_long_s', 's_as_f', 's_as_s', 's_kept', 'f_as_long_s']) s.longS[k] = P.reduce((t, p) => t + (p.arms[a].longS[k] || 0), 0);
      s.longS.unaligned_pages = P.filter((p) => !p.arms[a].longS.aligned).length;
      if (arms[LITE] && a !== LITE) {
        const d = P.map((p) => p.arms[a].N - p.arms[LITE].N), dd = P.map((p) => p.arms[a].D - p.arms[LITE].D);
        s.vs_L = { median_d_N: r4(median(d)), ci_d_N: bootCI(d)?.map(r4), wins: d.filter((x) => x < 0).length, losses: d.filter((x) => x > 0).length,
          median_d_D: r4(median(dd)), ci_d_D: bootCI(dd)?.map(r4) };
        if (cent !== 'all' && (OPEN.includes(a) || BASE_EXTRA.includes(a))) {
          const c1 = s.vs_L.ci_d_N && s.vs_L.ci_d_N[1] < 0, c2 = noise != null && Math.abs(s.vs_L.median_d_N) > noise && s.vs_L.median_d_N < 0, c3 = s.catastrophic <= liteCat + 1;
          s.bar = { ci_below_0: !!c1, beyond_noise: !!c2, catastrophic_ok: c3, passes: !!(c1 && c2 && c3) };
        }
      }
      c.arms[a] = s;
    }
    if (cent !== 'all') {
      const pass = OPEN.filter((a) => c.arms[a]?.bar?.passes).sort((x, y) => c.arms[x].median_N - c.arms[y].median_N);
      c.verdict = pass.length ? { lane: pass[0], also_pass: pass.slice(1) } : { lane: null };
    }
    res.cells[cent] = c;
  }
  res.pages = pages;
  const out = opt('out');
  if (out) fs.writeFileSync(out, JSON.stringify(res, null, 1) + '\n');
  for (const cent of ['1600s', '1500s']) {
    const c = res.cells[cent];
    console.log(`\n${cent} (n=${c.n}) noise floor N ${c.noise_floor_N}  verdict ${JSON.stringify(c.verdict)}`);
    console.log('arm\tmedN\tciN\t\tmedD\tplainN\td_vs_L\tci_d\t\tW/L\tcat\tloop\tcap\tſ→f\tſ→s\tſ kept/ref ſ\tbar');
    for (const a of res.arms) {
      const s = c.arms[a]; const v = s.vs_L || {};
      console.log([a, s.median_N, JSON.stringify(s.ci_N), s.median_D, s.median_N_plain, v.median_d_N ?? '', JSON.stringify(v.ci_d_N ?? ''), v.wins != null ? `${v.wins}/${v.losses}` : '', s.catastrophic, s.loops, s.cap,
        s.longS.s_as_f, s.longS.s_as_s, `${s.longS.s_kept}/${s.longS.ref_long_s}`, s.bar ? (s.bar.passes ? 'PASS' : `${+s.bar.ci_below_0}${+s.bar.beyond_noise}${+s.bar.catastrophic_ok}`) : ''].join('\t'));
    }
  }
}
main();
