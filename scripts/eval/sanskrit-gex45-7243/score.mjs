#!/usr/bin/env node
// PRIOR ART: scripts/eval/latin-bakeoff-5924/score.mjs (order tolerance `reorder`, `lev`, the paired bootstrap and the
// catastrophic-page rule, copied: that file runs main() on import, so it cannot be imported). scripts/eval/lib/metrics.mjs
// SCRIPT_DEFS.devanagari (letters 0900–094F + 0958–096F, dandas to spaces) is the house normaliser, but it keeps no
// diplomatic view, folds neither ASCII digits nor visarga-as-colon nor the old अ+matra vowel spellings, and has no
// fixture for combining marks (#5123). This is the #7243 Devanagari scorer; its self-test pins those folds.
/**
 * score.mjs — Devanagari page CER for the #7243 Sanskrit GPU-vs-Flash test (PREREG.md in this directory).
 *
 *   node score.mjs <arms dir> [--refs <dir>] [--out results.json]      node score.mjs --self-test
 * <arms dir>/<ARM>.jsonl(.gz): rows {page_id | uid, text, finish?, error?}; the last row per page wins. A page with no row,
 * an error or empty text scores CER 1.0 and counts as catastrophic. Refs: <refs>/<slug>.txt (default ./refs).
 *
 * Views (fixed in PREREG.md before any engine read a page):
 *   N (primary)  NFC; ZWJ/ZWNJ removed; old अ+matra spellings folded (अा→आ, अो→ओ, अौ→औ, एे→ऐ); ASCII digits → Devanagari
 *                digits; an ASCII colon right after a Devanagari sign → visarga; Vedic accents and the abbreviation sign
 *                dropped; then only Devanagari letters, signs and digits are kept (dandas, punctuation, spaces and every
 *                other script dropped). CER = Levenshtein over code points / reference length, capped at 1.
 *   D (diplomatic, secondary)  NFC, ZW removed, Devanagari block + Vedic accents kept, nothing folded.
 * The deciding CER is N on the order-tolerant engine text (lines re-placed at their reference offset by 6-gram votes).
 * Invention: engine N-view characters inside 8-grams that occur nowhere in the reference N view, as runs; a run of
 * ≥ 40 such characters is an "inserted passage" (the recall check for recitation, #4523).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : null; };
const SEED = 7243, B = 10000;
export const NORMALISER_VERSION = 'deva-n@1';

// ── text views ───────────────────────────────────────────────────────────────
export function clean(t) {
  let s = String(t || '').replace(/<<<(BEGIN|END)>>>/g, '\n');
  s = s.replace(/^﻿?---\n[\s\S]*?\n---\n/, '');                         // front matter
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '\n').replace(/<[^>\n]{1,200}>/g, '\n');   // image links, HTML tags
  return s.replace(/^\s{0,3}#{1,6}\s+/gm, '').replace(/\*\*|__/g, '').replace(/\$\$?/g, '');
}
const ASCII_DIG = '0123456789', DEVA_DIG = '०१२३४५६७८९';
export function nview(s) {
  let t = String(s || '').normalize('NFC').replace(/[‌‍]/g, '');
  t = t.replace(/अा/g, 'आ').replace(/अो/g, 'ओ').replace(/अौ/g, 'औ').replace(/एे/g, 'ऐ').replace(/अॅ/g, 'ॲ').replace(/अॉ/g, 'ऑ');
  t = t.replace(/[0-9]/g, (d) => DEVA_DIG[ASCII_DIG.indexOf(d)]);
  t = t.replace(/([ऀ-ॣ])[:：]/g, '$1ः');
  t = t.replace(/[॑-॔᳐-᳿꣠-꣱॰]/g, '');
  return (t.match(/[ऀ-ॣ०-९ॱ-ॿ]/g) || []).join('');
}
export const dview = (s) => (String(s || '').normalize('NFC').replace(/[‌‍]/g, '').match(/[ऀ-ॣ०-ॿ᳐-᳿꣠-ꣿ]/g) || []).join('');

/** Order tolerance: each line goes to the reference offset where most of its 6-grams fall; no hit = after the line before. */
export function reorder(ref, lines, K = 6) {
  const idx = new Map();
  for (let p = 0; p + K <= ref.length; p++) { const g = ref.slice(p, p + K); const a = idx.get(g); if (a) a.push(p); else idx.set(g, [p]); }
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
export const cer = (r, h) => (r.length ? Math.min(1, lev(r, h) / [...r].length) : (h.length ? 1 : 0));

export function views(refRaw, hypRaw) {
  const R = { N: nview(refRaw), D: dview(refRaw) };
  const lines = clean(hypRaw).split('\n');
  const linesN = lines.map(nview), linesD = lines.map(dview);
  const order = reorder(R.N, linesN);
  return { R, H: { N: linesN.join(''), D: linesD.join(''), Nr: order.map((i) => linesN[i]).join(''), Dr: order.map((i) => linesD[i]).join('') }, moved: order.some((v, i) => v !== i) };
}

/** Engine characters not supported by any reference 8-gram, and the runs they form. */
export function invention(ref, hyp, K = 8, RUN = 40) {
  const g = new Set(); for (let p = 0; p + K <= ref.length; p++) g.add(ref.slice(p, p + K));
  const cov = new Uint8Array(hyp.length);
  for (let i = 0; i + K <= hyp.length; i++) if (g.has(hyp.slice(i, i + K))) cov.fill(1, i, i + K);
  let chars = 0, runs = [], cur = 0, start = 0;
  for (let i = 0; i <= hyp.length; i++) {
    if (i < hyp.length && !cov[i]) { if (!cur) start = i; cur++; chars++; } else if (cur) { if (cur >= RUN) runs.push({ at: start, len: cur, text: hyp.slice(start, start + Math.min(cur, 80)) }); cur = 0; }
  }
  return { chars, share: hyp.length ? chars / hyp.length : 0, passages: runs };
}

// ── stats ────────────────────────────────────────────────────────────────────
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const k = s.length >> 1; return s.length ? (s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2) : null; };
export function bootCI(xs) {
  if (xs.length < 2) return null; const rnd = mulberry32(SEED); const meds = new Float64Array(B);
  for (let b = 0; b < B; b++) { const s = new Array(xs.length); for (let j = 0; j < xs.length; j++) s[j] = xs[Math.floor(rnd() * xs.length)]; meds[b] = median(s); }
  meds.sort(); return [meds[Math.floor(B * 0.025)], meds[Math.floor(B * 0.975) - 1]];
}
const r4 = (x) => (x == null ? null : Math.round(x * 10000) / 10000);

function loadArm(file) {
  const raw = file.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(file)).toString('utf8') : fs.readFileSync(file, 'utf8');
  const rows = {};
  for (const l of raw.split('\n')) {
    if (!l.trim()) continue; const r = JSON.parse(l); const id = r.page_id || r.uid;
    rows[id] = { text: r.error && !r.text ? '' : String(r.text || ''), finish: r.finish || null, error: r.error || null, blocked: !!r.blocked };
  }
  return rows;
}

export function scorePage(refRaw, text, finish) {
  const refN = nview(refRaw);
  if (!String(text || '').trim()) return { N: 1, D: 1, Nplain: 1, empty: true, loop: false, catastrophic: true, ref_chars: refN.length, hyp_chars: 0, inv_chars: 0, inv_share: 0, passages: 0 };
  const v = views(refRaw, text); const N = cer(v.R.N, v.H.Nr); const inv = invention(v.R.N, v.H.Nr);
  const loop = v.H.N.length > 2 * v.R.N.length + 50;
  return { N: r4(N), D: r4(cer(v.R.D, v.H.Dr)), Nplain: r4(cer(v.R.N, v.H.N)), moved: v.moved, empty: false, loop,
    catastrophic: N > 0.5 || loop, cap: ['length', 'MAX_TOKENS'].includes(finish), ref_chars: v.R.N.length, hyp_chars: v.H.N.length,
    inv_chars: inv.chars, inv_share: r4(inv.share), passages: inv.passages.length, passage_samples: inv.passages.slice(0, 3) };
}

function selfTest() {
  const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } };
  // combining marks survive: a dropped virama, a swapped matra, a lost anusvara each cost exactly one code point
  ok(nview('धर्मक्षेत्रे कुरुक्षेत्रे') === 'धर्मक्षेत्रेकुरुक्षेत्रे', 'conjuncts and matras kept, spaces dropped');
  ok(lev(nview('धर्मक्षेत्रे'), nview('धरमक्षेत्रे')) === 1, 'a dropped virama = 1 edit');
  ok(lev(nview('संयुगे'), nview('सयुगे')) === 1, 'lost anusvara = 1 edit');
  ok(lev(nview('कुरुक्षेत्रे'), nview('कुरूक्षेत्रे')) === 1, 'u vs uu matra = 1 edit');
  // folds: NFC nukta, old a+matra spellings, ASCII digits, colon-for-visarga, dandas, Vedic accents, ZWJ
  ok(nview('क़') === nview('क़'), 'nukta precomposed = decomposed');
  ok(nview('अोम्') === nview('ओम्'), 'अो folds to ओ');
  ok(nview('॥ २४ ॥') === nview('|| 24 ||'), 'ASCII digits and pipes fold');
  ok(nview('रामः') === nview('राम:'), 'colon after a sign folds to visarga');
  ok(nview('अ॒ग्निमी॑ळे') === nview('अग्निमीळे'), 'Vedic accents dropped in N');
  ok(dview('अ॒ग्नि') !== dview('अग्नि'), 'Vedic accents kept in D');
  ok(nview('क्‍ष') === nview('क्ष'), 'ZWJ dropped');
  ok(nview('Bhīṣma भीष्म') === 'भीष्म', 'Latin dropped');
  // order tolerance and invention
  const v = views('धृतराष्ट्र उवाच धर्मक्षेत्रे\nकुरुक्षेत्रे समवेता युयुत्सवः\nमामकाः पाण्डवाश्चैव किमकुर्वत सञ्जय', 'मामकाः पाण्डवाश्चैव किमकुर्वत सञ्जय\nधृतराष्ट्र उवाच धर्मक्षेत्रे\nकुरुक्षेत्रे समवेता युयुत्सवः');
  ok(cer(v.R.N, v.H.Nr) === 0 && cer(v.R.N, v.H.N) > 0, 'reorder fixes a moved line');
  const inv = invention(nview('यदा यदा हि धर्मस्य ग्लानिर्भवति भारत'), nview('यदा यदा हि धर्मस्य ग्लानिर्भवति भारत अभ्युत्थानमधर्मस्य तदात्मानं सृजाम्यहम् परित्राणाय साधूनां विनाशाय च दुष्कृताम्'));
  ok(inv.passages.length === 1, 'a recited continuation is one inserted passage');
  ok(scorePage('राम', '').catastrophic, 'empty read is catastrophic');
  if (!process.exitCode) console.log('self-test ok', NORMALISER_VERSION);
}

function main() {
  if (args.includes('--self-test')) return selfTest();
  const dir = args[0]; const refs = opt('refs') || path.join(HERE, 'refs');
  const manifest = JSON.parse(fs.readFileSync(path.join(HERE, 'pages.json'), 'utf8')).pages;
  const arms = {};
  for (const f of fs.readdirSync(dir).filter((x) => /^[A-Za-z0-9-]+\.jsonl(\.gz)?$/.test(x))) arms[f.split('.')[0]] = loadArm(path.join(dir, f));
  const pages = [];
  for (const p of manifest) {
    const rf = path.join(refs, `${p.slug}.txt`); if (!fs.existsSync(rf)) continue;
    const refRaw = fs.readFileSync(rf, 'utf8');
    const row = { slug: p.slug, kind: p.observed.kind, hard: !!p.observed.hard, canonical: !!p.observed.canonical, lang: p.observed.lang, arms: {} };
    for (const [a, rows] of Object.entries(arms)) { const r = rows[p.slug]; row.arms[a] = scorePage(refRaw, r ? r.text : '', r?.finish); }
    pages.push(row);
  }
  const res = { normaliser: NORMALISER_VERSION, seed: SEED, resamples: B, arms: Object.keys(arms).sort(), cells: {}, pages };
  const BASE = arms.F ? 'F' : null;
  for (const cell of ['all', 'print', 'manuscript', 'hard', 'canonical']) {
    const P = pages.filter((p) => cell === 'all' || (cell === 'hard' ? p.hard : cell === 'canonical' ? p.canonical : p.kind === cell));
    const c = { n: P.length, arms: {} };
    if (arms.F && arms.F2) c.noise_floor_N = r4(median(P.map((p) => Math.abs(p.arms.F.N - p.arms.F2.N))));
    for (const a of res.arms) {
      const xs = P.map((p) => p.arms[a].N);
      const s = { median_N: r4(median(xs)), ci_N: bootCI(xs)?.map(r4), mean_N: r4(xs.reduce((t, x) => t + x, 0) / (xs.length || 1)),
        median_D: r4(median(P.map((p) => p.arms[a].D))), median_N_plain: r4(median(P.map((p) => p.arms[a].Nplain))),
        catastrophic: P.filter((p) => p.arms[a].catastrophic).length, loops: P.filter((p) => p.arms[a].loop).length, empty: P.filter((p) => p.arms[a].empty).length,
        cap: P.filter((p) => p.arms[a].cap).length, passage_pages: P.filter((p) => p.arms[a].passages > 0).length,
        inv_share_median: r4(median(P.map((p) => p.arms[a].inv_share))) };
      if (BASE && a !== BASE) {
        const d = P.map((p) => p.arms[a].N - p.arms[BASE].N);
        s.vs_F = { median_d: r4(median(d)), ci_d: bootCI(d)?.map(r4), wins: d.filter((x) => x < 0).length, losses: d.filter((x) => x > 0).length };
        const fc = P.filter((p) => p.arms[BASE].catastrophic).length, fp = P.filter((p) => p.arms[BASE].passages > 0).length;
        s.gate = { ci_upper_le_2pt: !!(s.vs_F.ci_d && s.vs_F.ci_d[1] <= 0.02), catastrophic_ok: s.catastrophic <= fc + 1, passages_ok: s.passage_pages <= fp + 1 };
        s.gate.passes = s.gate.ci_upper_le_2pt && s.gate.catastrophic_ok && s.gate.passages_ok;
      }
      c.arms[a] = s;
    }
    res.cells[cell] = c;
  }
  const out = opt('out'); if (out) fs.writeFileSync(out, JSON.stringify(res, null, 1) + '\n');
  for (const cell of Object.keys(res.cells)) {
    const c = res.cells[cell];
    console.log(`\n${cell} (n=${c.n})${c.noise_floor_N != null ? ` F-vs-F2 noise floor ${c.noise_floor_N}` : ''}`);
    console.log('arm\tmedN\tciN\t\tmeanN\tmedD\td_vs_F\tci_d\t\tW/L\tcat\tloop\tempty\tpassg\tgate');
    for (const a of res.arms) {
      const s = c.arms[a]; const v = s.vs_F || {};
      console.log([a, s.median_N, JSON.stringify(s.ci_N), s.mean_N, s.median_D, v.median_d ?? '', JSON.stringify(v.ci_d ?? ''), v.wins != null ? `${v.wins}/${v.losses}` : '',
        s.catastrophic, s.loops, s.empty, s.passage_pages, s.gate ? (s.gate.passes ? 'PASS' : `${+s.gate.ci_upper_le_2pt}${+s.gate.catastrophic_ok}${+s.gate.passages_ok}`) : ''].join('\t'));
    }
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();   // importable: rr.mjs uses views/cer
