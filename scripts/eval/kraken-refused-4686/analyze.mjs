#!/usr/bin/env node
// PRIOR ART: benchmark-score.mjs (CER, gap, invention, refusals — its result file is read here, never
// recomputed); benchmark-dashboard-data.mjs (the seeded bootstrap copied below); open-engine-print-5660.mjs
// `tally` (long-s words read as f, on TCP pages). None applies a preregistered four-part gate, counts digit
// strings, or counts reference lines an arm dropped.
/**
 * analyze.mjs — the preregistered gate for `refused-en-4686` (#4686, PREREGISTRATION-kraken-refused-4686.md).
 *
 *   node scripts/eval/kraken-refused-4686/analyze.mjs --root=/root/kraken-refused-4686/bench \
 *        --scored=scripts/eval/results/benchmark/refused-en-4686-2026-10-06.json [--refs=<dir>] [--out=<file.json>]
 *
 * Per arm: median CER [bootstrap 95 %] (from the scorer's file), catastrophic pages, long-s words written
 * with f per 100 ſ-words, digit strings reproduced (pooled), reference lines dropped (pooled, worst page),
 * and the paired ΔCER of the fine-tune against stock CATMuS. Then G1–G4 on the chosen Kraken arm.
 * $0: reads files only.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const ROOT = argOf('root');
const SCORED = argOf('scored');
const REFS = argOf('refs', path.join(__dirname, '..', 'benchmark', 'refs'));
const OUT = argOf('out', null);
const STRATUM = 'refused-en-4686';
if (!ROOT || !SCORED) { console.error('--root and --scored required'); process.exit(1); }

const { pages } = JSON.parse(fs.readFileSync(SCORED, 'utf8'));
const outDir = path.join(ROOT, STRATUM, 'out');
const arms = fs.readdirSync(outDir).filter(a => fs.statSync(path.join(outDir, a)).isDirectory() && a !== 'script-class').sort();
const readArm = (a, slug) => { const f = path.join(outDir, a, `${slug}.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };

// ── statistics (seeded, as benchmark-dashboard-data.mjs) ──
const r3 = x => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);
const median = xs => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function bootMedian(xs, seed = 4686, B = 4000) {
  if (xs.length < 5) return null;
  const rand = rng(seed), meds = [];
  for (let b = 0; b < B; b++) { const s = []; for (let i = 0; i < xs.length; i++) s.push(xs[Math.floor(rand() * xs.length)]); meds.push(median(s)); }
  meds.sort((a, b) => a - b);
  return [r3(meds[Math.floor(0.025 * B)]), r3(meds[Math.floor(0.975 * B)])];
}

// ── text helpers ──
const fold = s => String(s || '').normalize('NFC').toLowerCase().replace(/ſ/g, 's').replace(/[’‘ʼ`´]/g, "'");
const letters = s => fold(s).replace(/[^\p{L}]+/gu, '');
const words = s => (String(s || '').normalize('NFC').toLowerCase().match(/[\p{L}ſ']+/gu) || []);

/** ſ-words in the reference; an error is the same word in the arm with f where the reference has ſ. */
function longS(ref, hyp) {
  const refWords = words(ref), hypCount = new Map();
  for (const w of words(hyp)) hypCount.set(w, (hypCount.get(w) || 0) + 1);
  const refPlain = new Map(); for (const w of refWords) if (!w.includes('ſ')) refPlain.set(w, (refPlain.get(w) || 0) + 1);
  const want = new Map(); let n = 0;
  for (const w of refWords) if (w.includes('ſ')) { n++; const f = w.replace(/ſ/g, 'f'); want.set(f, (want.get(f) || 0) + 1); }
  let err = 0;
  for (const [f, k] of want) err += Math.min(k, Math.max(0, (hypCount.get(f) || 0) - (refPlain.get(f) || 0)));
  return { n, err };
}
/** digit strings: reference multiset, how many the arm reproduces exactly. */
function digits(ref, hyp) {
  const r = String(ref).match(/\d+/g) || [], h = String(hyp || '').match(/\d+/g) || [];
  const c = new Map(); for (const d of h) c.set(d, (c.get(d) || 0) + 1);
  let hit = 0; for (const d of r) { const k = c.get(d); if (k) { hit++; c.set(d, k - 1); } }
  return { n: r.length, hit };
}
/** Sellers semi-global edit distance: the pattern against its best-matching substring of the text. */
function bestSub(p, t) {
  const m = p.length; let prev = new Uint16Array(m + 1), cur = new Uint16Array(m + 1);
  for (let i = 0; i <= m; i++) prev[i] = i;
  let best = m;
  for (let j = 1; j <= t.length; j++) {
    cur[0] = 0;
    for (let i = 1; i <= m; i++) cur[i] = Math.min(prev[i] + 1, cur[i - 1] + 1, prev[i - 1] + (p[i - 1] === t[j - 1] ? 0 : 1));
    if (cur[m] < best) best = cur[m];
    [prev, cur] = [cur, prev];
  }
  return best;
}
/** reference lines (≥ 15 letters) with no window in the arm at line CER ≤ 0.5. */
function dropped(ref, hyp) {
  const t = letters(hyp);
  const lines = String(ref).split('\n').map(letters).filter(l => l.length >= 15);
  let drop = 0; const examples = [];
  for (const l of lines) { const d = t.length ? bestSub(l, t) / l.length : 1; if (d > 0.5) { drop++; if (examples.length < 3) examples.push(l.slice(0, 40)); } }
  return { n: lines.length, drop, examples };
}

const res = { stratum: STRATUM, scored: path.basename(SCORED), refs: REFS, n_pages: pages.length, arms: {} };
for (const a of arms) {
  const per = [];
  for (const p of pages) {
    const m = p.engines[a]; if (!m || m.missing) continue;
    const ref = fs.readFileSync(path.join(REFS, `${p.slug}.txt`), 'utf8');
    const hyp = readArm(a, p.slug) || '';
    per.push({ slug: p.slug, cer: m.refused ? 1 : m.cer, refused: !!m.refused, gap: m.gap, loop: !!m.loop, longs: longS(ref, hyp), digits: digits(ref, hyp), lines: dropped(ref, hyp) });
  }
  const cers = per.map(x => x.cer).filter(x => x != null);
  const ls = per.reduce((s, x) => ({ n: s.n + x.longs.n, err: s.err + x.longs.err }), { n: 0, err: 0 });
  const dg = per.reduce((s, x) => ({ n: s.n + x.digits.n, hit: s.hit + x.digits.hit }), { n: 0, hit: 0 });
  const ln = per.reduce((s, x) => ({ n: s.n + x.lines.n, drop: s.drop + x.lines.drop }), { n: 0, drop: 0 });
  const worstDrop = per.reduce((w, x) => { const r = x.lines.n ? x.lines.drop / x.lines.n : 0; return r > w.rate ? { rate: r, slug: x.slug, examples: x.lines.examples } : w; }, { rate: 0, slug: null, examples: [] });
  res.arms[a] = {
    n: per.length, refused: per.filter(x => x.refused).length, loops: per.filter(x => x.loop).length,
    median_cer: r3(median(cers)), ci95: bootMedian(cers), catastrophic: cers.filter(c => c > 0.5).length,
    median_gap: r3(median(per.map(x => x.gap).filter(x => x != null))),
    long_s: { ref_words: ls.n, as_f: ls.err, per_100: ls.n ? r3(100 * ls.err / ls.n) : null },
    digits: { ref: dg.n, reproduced: dg.hit, share: dg.n ? r3(dg.hit / dg.n) : null },
    lines: { ref: ln.n, dropped: ln.drop, share: ln.n ? r3(ln.drop / ln.n) : null, worst_page: { slug: worstDrop.slug, share: r3(worstDrop.rate), examples: worstDrop.examples } },
    pages: per.map(x => ({ slug: x.slug, cer: x.cer, gap: x.gap, longs_err: x.longs.err, longs_n: x.longs.n, digits: `${x.digits.hit}/${x.digits.n}`, dropped: `${x.lines.drop}/${x.lines.n}` })),
  };
}

// paired fine-tune − stock (preregistered arm choice)
const A = 'kraken-catmus', F = 'kraken-catmus-ft-5730';
let chosen = A;
if (res.arms[A] && res.arms[F]) {
  const byA = new Map(res.arms[A].pages.map(x => [x.slug, x.cer]));
  const d = res.arms[F].pages.filter(x => byA.get(x.slug) != null && x.cer != null).map(x => x.cer - byA.get(x.slug));
  res.paired_ft_minus_catmus = { n: d.length, median: r3(median(d)), ci95: bootMedian(d, 5730), better: d.filter(x => x < 0).length, worse: d.filter(x => x > 0).length };
  if (res.paired_ft_minus_catmus.ci95 && res.paired_ft_minus_catmus.ci95[1] < 0) chosen = F;
}
const c = res.arms[chosen];
res.gate = c ? {
  arm: chosen,
  G1: { rule: 'median CER <= 0.08 and upper 95% bound <= 0.12', value: { median: c.median_cer, ci95: c.ci95 }, pass: c.median_cer != null && c.median_cer <= 0.08 && !!c.ci95 && c.ci95[1] <= 0.12 },
  G2: { rule: 'catastrophic (CER > 0.5) <= 2 of 20', value: c.catastrophic, pass: c.catastrophic <= 2 },
  G3: { rule: 'dropped lines <= 5% pooled and <= 20% on every page', value: { pooled: c.lines.share, worst: c.lines.worst_page.share }, pass: c.lines.share != null && c.lines.share <= 0.05 && (c.lines.worst_page.share ?? 0) <= 0.2 },
  G4: { rule: '>= 90% of reference digit strings reproduced, pooled', value: c.digits.share, pass: c.digits.share != null && c.digits.share >= 0.9 },
} : null;
if (res.gate) res.gate.pass = ['G1', 'G2', 'G3', 'G4'].every(k => res.gate[k].pass);

console.log('| arm | n | median CER [95%] | catastrophic | ſ→f per 100 ſ-words | digits reproduced | lines dropped (worst page) | gap |');
console.log('|---|---:|---|---:|---:|---:|---|---:|');
for (const [a, s] of Object.entries(res.arms)) console.log(`| ${a} | ${s.n} | ${s.median_cer} [${s.ci95?.join(', ') ?? '—'}] | ${s.catastrophic} | ${s.long_s.per_100} (${s.long_s.as_f}/${s.long_s.ref_words}) | ${s.digits.share} (${s.digits.reproduced}/${s.digits.ref}) | ${s.lines.share} (${s.lines.dropped}/${s.lines.ref}; ${s.lines.worst_page.share} ${s.lines.worst_page.slug || ''}) | ${s.median_gap} |`);
if (res.paired_ft_minus_catmus) console.log(`paired ft − catmus: median ${res.paired_ft_minus_catmus.median} [${res.paired_ft_minus_catmus.ci95}] better ${res.paired_ft_minus_catmus.better} / worse ${res.paired_ft_minus_catmus.worse}`);
if (res.gate) console.log(`GATE (${res.gate.arm}): ${['G1', 'G2', 'G3', 'G4'].map(k => `${k} ${res.gate[k].pass ? 'pass' : 'FAIL'} ${JSON.stringify(res.gate[k].value)}`).join(' · ')} → ${res.gate.pass ? 'PASS' : 'STOP'}`);
if (OUT) { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(res, null, 2) + '\n'); console.log(`wrote ${OUT}`); }
