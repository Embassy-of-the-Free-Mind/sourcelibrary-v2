#!/usr/bin/env node
// PRIOR ART: benchmark-cost-lane.mjs (the #4925 cost-lane rule per cell, its seeded bootstrap of the median Δ — copied
// here verbatim) and open-engine-print-5660.mjs `tally` (long-s / abbreviation counts — same regexes). Neither applies
// the #5730 prereg's beats/ties/loses rule, splits library vs Wikisource pages, or adds the convention-folded CER.
/**
 * analyse.mjs — the #5730 verdict table from benchmark-score.mjs output (PREREGISTRATION-kraken-latin-ft-5730.md).
 *
 *   node scripts/eval/kraken-ft-5730/analyse.mjs --results=<dir with <stratum>-<date>.json> --root=<bench root> \
 *        --refs=<benchmark/refs dir> --ws=<ground-truth-ws dir> [--out=<json>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { binomTwoSided, resetSeed, seededRand } from '../lib/paired-stats.mjs';
import { levenshtein, scoreAgainstReference } from '../lib/metrics.mjs';
import { stripMarkupTags } from '../../lib/strip-markup-tags.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const RES = argOf('results'); const ROOT = argOf('root'); const REFS = argOf('refs'); const WS = argOf('ws');
const OUT = argOf('out', path.join(__dirname, '..', 'results', 'kraken-ft-5730', 'verdict.json'));
const LITE = 'gemini-3.1-flash-lite', CAT = 'kraken-catmus', FT = 'kraken-ft-5730';
const ENGINES = [LITE, CAT, FT];
const TEST = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'results', 'kraken-ft-5730', 'test-set.json'), 'utf8')).pages;
const r3 = x => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);
const median = xs => { const s = xs.filter(x => x != null).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function bootstrapMedianCI(xs, B = 5000) {   // = benchmark-cost-lane.mjs
  if (xs.length < 2) return null;
  resetSeed(0x4925);
  const meds = [];
  for (let b = 0; b < B; b++) { const s = []; for (let j = 0; j < xs.length; j++) s.push(xs[Math.floor(seededRand() * xs.length)]); meds.push(median(s)); }
  meds.sort((a, b) => a - b);
  return [r3(meds[Math.floor(B * 0.025)]), r3(meds[Math.floor(B * 0.975)])];
}
const latest = st => { const f = fs.readdirSync(RES).filter(x => x.startsWith(`${st}-`) && /^\d{4}-\d{2}-\d{2}\.json$/.test(x.slice(st.length + 1))).sort().pop(); return JSON.parse(fs.readFileSync(path.join(RES, f), 'utf8')); };

// per-page CER from the scorer, keyed by slug
const scored = new Map();
for (const st of ['eebo-tcp-5488', 'eebo-tcp-latin-5660', 'ref-ws']) for (const p of latest(st).pages) scored.set(p.slug, { ...p, stratum: st });

// convention-folded CER: marks and diacritics removed, ſ→s, u→v, j→i, ¬→-, letters only (the prereg's check that a gain is
// reading, not abbreviation-convention matching). Whole-page Levenshtein on EEBO pages; the passage aligner on ref-ws.
const fold = t => stripMarkupTags(String(t || '')).normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/ſ/g, 's').replace(/u/g, 'v').replace(/j/g, 'i').replace(/¬/g, '-');
const lettersOnly = s => s.replace(/[^\p{L}\p{N}]+/gu, '');
function foldedCer(row, e) {
  const hf = path.join(ROOT, row.stratum, 'out', e, `${row.slug}.txt`);
  if (!fs.existsSync(hf)) return null;
  const hyp = fs.readFileSync(hf, 'utf8');
  if (row.stratum === 'ref-ws') {
    const g = JSON.parse(fs.readFileSync(path.join(WS, `${row.slug}.json`), 'utf8'));
    try { const r = scoreAgainstReference(fold(g.ocr_ground_truth), fold(hyp), 'latin'); return r.charAccuracyWindowed == null ? null : 1 - r.charAccuracyWindowed; } catch { return null; }
  }
  const rf = path.join(REFS, `${row.slug}.txt`); if (!fs.existsSync(rf)) return null;
  const R = [...lettersOnly(fold(fs.readFileSync(rf, 'utf8')))], H = [...lettersOnly(fold(hyp))].slice(0, 6000);
  return R.length ? levenshtein(H, R.slice(0, 6000)) / Math.min(R.length, 6000) : null;
}

// long-s and abbreviation tallies (open-engine-print-5660.mjs `tally`, same regexes), per engine over the test pages with a reference
const words = t => (t.normalize('NFC').toLowerCase().match(/[\p{L}ſ]+/gu) || []);
const ABBR = /[āēīōūǣ̄ꝑꝓꝗꝙꝯꝫ̃ẽõũ]|q;/gu;
function tally(e) {
  const T = { pages: 0, long_s_glyph: 0, f_for_s: 0, abbrev_marks: 0, ref_long_s_glyph: 0, ref_abbrev_marks: 0 };
  for (const p of TEST) {
    const hf = path.join(ROOT, p.stratum, 'out', e, `${p.slug}.txt`); if (!fs.existsSync(hf)) continue;
    const t = fs.readFileSync(hf, 'utf8'); T.pages++;
    T.long_s_glyph += (t.match(/ſ/g) || []).length; T.abbrev_marks += (t.normalize('NFC').match(ABBR) || []).length;
    let ref = null;
    if (p.stratum === 'ref-ws') ref = JSON.parse(fs.readFileSync(path.join(WS, `${p.slug}.json`), 'utf8')).ocr_ground_truth;
    else if (fs.existsSync(path.join(REFS, `${p.slug}.txt`))) ref = fs.readFileSync(path.join(REFS, `${p.slug}.txt`), 'utf8');
    if (!ref) continue;
    const refSet = new Set(words(ref).map(w => w.replace(/ſ/g, 's')));
    T.ref_long_s_glyph += (ref.match(/ſ/g) || []).length; T.ref_abbrev_marks += (ref.normalize('NFC').match(ABBR) || []).length;
    for (const w of words(t)) if (w.includes('f') && !refSet.has(w.replace(/ſ/g, 's')) && refSet.has(w.replace(/f/g, 's'))) T.f_for_s++;
  }
  return T;
}

const rows = TEST.map(t => { const s = scored.get(t.slug); return { slug: t.slug, stratum: t.stratum, origin: t.origin, year: t.year, s }; });
const cer = (r, e) => { const m = r.s?.engines?.[e]; return m && !m.missing && typeof m.cer === 'number' ? m.cer : null; };
const usable = r => r.s && !r.s.ref_mismatch && (r.stratum === 'ref-ws' || r.s.has_ref);

function compare(subset, A, B) {   // Δ = CER(A) − CER(B)
  const P = subset.filter(r => usable(r) && cer(r, A) != null && cer(r, B) != null);
  const d = P.map(r => cer(r, A) - cer(r, B));
  const wins = d.filter(x => x < -1e-9).length, losses = d.filter(x => x > 1e-9).length;
  const ci = bootstrapMedianCI(d); const p = wins + losses ? binomTwoSided(Math.max(wins, losses), wins + losses) : null;
  const cat = e => P.filter(r => cer(r, e) > 0.5).length;
  const verdict = ci == null ? 'n/a' : ci[1] < 0 && p < 0.05 && cat(A) <= cat(B) ? 'beats' : ci[0] > 0 ? 'loses to' : 'ties';
  const fd = P.map(r => { const a = foldedCer(r, A), b = foldedCer(r, B); return a != null && b != null ? a - b : null; }).filter(x => x != null);
  return { n: P.length, median_cer: { [A]: r3(median(P.map(r => cer(r, A)))), [B]: r3(median(P.map(r => cer(r, B)))) }, mean_cer: { [A]: r3(P.reduce((s, r) => s + cer(r, A), 0) / P.length), [B]: r3(P.reduce((s, r) => s + cer(r, B), 0) / P.length) },
    median_delta: r3(median(d)), ci95: ci, wins, losses, ties: d.length - wins - losses, p_sign: r3(p), catastrophic: { [A]: cat(A), [B]: cat(B) }, verdict,
    folded: { n: fd.length, median_delta: r3(median(fd)), ci95: bootstrapMedianCI(fd), wins: fd.filter(x => x < -1e-9).length, losses: fd.filter(x => x > 1e-9).length } };
}
const subsets = { all: rows, library: rows.filter(r => r.origin === 'library'), wikisource: rows.filter(r => r.origin === 'external') };
const out = { prereg: 'PREREGISTRATION-kraken-latin-ft-5730.md', n_test: rows.length, unusable: rows.filter(r => !usable(r)).map(r => r.slug), comparisons: {}, tally: {}, per_page: [] };
for (const [k, sub] of Object.entries(subsets)) out.comparisons[k] = { ft_vs_lite: compare(sub, FT, LITE), ft_vs_catmus: compare(sub, FT, CAT), catmus_vs_lite: compare(sub, CAT, LITE) };
for (const e of ENGINES) out.tally[e] = tally(e);
out.per_page = rows.map(r => ({ slug: r.slug, origin: r.origin, year: r.year, ...Object.fromEntries(ENGINES.map(e => [e, r3(cer(r, e))])), ...Object.fromEntries(ENGINES.map(e => [`${e}_folded`, r3(foldedCer(r, e))])) }));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
for (const [k, c] of Object.entries(out.comparisons)) for (const [name, v] of Object.entries(c)) console.log(`${k.padEnd(10)} ${name.padEnd(15)} n=${v.n} ${JSON.stringify(v.median_cer)} Δ=${v.median_delta} ${JSON.stringify(v.ci95)} W/L/T=${v.wins}/${v.losses}/${v.ties} p=${v.p_sign} cat=${JSON.stringify(v.catastrophic)} → ${v.verdict} | folded Δ=${v.folded.median_delta} ${JSON.stringify(v.folded.ci95)}`);
console.log(JSON.stringify(out.tally));
