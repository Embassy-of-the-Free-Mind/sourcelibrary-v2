#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/lib/metrics.mjs (`computeCER` — whole-page global distance after an
 * English/Latin-oriented clean); scripts/eval/en-ocr-reference-5124.mjs --stage=score (page-level
 * Wikisource join). Neither scores a verse-cut reference inside a page that also carries apparatus,
 * nor folds Coptic. Uses ./coptic-lib.mjs for both.
 *
 * coptic-5778/score — CER of stored / lite / flash against Coptic SCRIPTORIUM (#5778). No network,
 * no database: reads sample.jsonl + reads.jsonl (+ the private Sahidica verses kept out of the repo).
 *
 *  manuscript pages (unit=page): GLOBAL edit distance between the edition's extant letters for that
 *    manuscript page and the whole read. Omissions and inventions both count.
 *  printed pages (unit=verse): the page's verses are the contiguous run between the first and last
 *    verse that ANY reading matches at < MATCH (so no engine picks its own denominator); each verse
 *    is scored by infix distance inside each read, so apparatus and running heads cost nothing.
 *
 *   node scripts/eval/coptic-5778/score.mjs --out scripts/eval/results/coptic-5778 --private-dir <dir>
 */
import fs from 'node:fs';
import path from 'node:path';
import { normCoptic, cleanOcr, infixDistance } from './coptic-lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('--out'); const PRIV = arg('--private-dir');
const MATCH = 0.25, MIN_LETTERS = 12, ARMS = ['stored', 'lite', 'flash'];
const jsonl = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

const sample = jsonl(path.join(OUT, 'sample.jsonl'));
const reads = jsonl(path.join(OUT, 'reads.jsonl'));
const privFile = PRIV && path.join(PRIV, 'private-refs.jsonl');
const priv = new Map(privFile && fs.existsSync(privFile) ? jsonl(privFile).map((r) => [r.id, r.units]) : []);

function levenshtein(a, b) {
  let prev = Uint32Array.from({ length: b.length + 1 }, (_, j) => j), cur = new Uint32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), prev[j] + 1, cur[j - 1] + 1);
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}
const letterMix = (text) => {
  const t = cleanOcr(text); let coptic = 0, greek = 0, latin = 0;
  for (const ch of t) { const cp = ch.codePointAt(0); if ((cp >= 0x2c80 && cp <= 0x2cff) || (cp >= 0x3e2 && cp <= 0x3ef)) coptic++; else if ((cp >= 0x370 && cp <= 0x3e1) || (cp >= 0x3f0 && cp <= 0x3ff) || (cp >= 0x1f00 && cp <= 0x1fff)) greek++; else if (/[a-zA-Z]/.test(ch)) latin++; }
  return { coptic, greek, latin };
};

const pages = [];
for (const s of sample) {
  const texts = { stored: s.stored?.text ?? null };
  const info = { stored: s.stored ? { model: s.stored.model } : null };
  for (const r of reads.filter((r) => r.id === s.id)) { texts[r.arm] = r.text ?? null; info[r.arm] = { model: r.model, finish_reason: r.finish_reason, cost_usd: r.cost_usd }; }
  const norm = {}; const mix = {};
  for (const a of ARMS) if (texts[a] != null) { norm[a] = normCoptic(cleanOcr(texts[a])); mix[a] = letterMix(texts[a]); }
  const row = { id: s.id, title: s.title, page_number: s.page_number, stratum: s.stratum, unit: s.unit, corpus: s.reference.corpus, same_edition: s.same_edition, arms: {} };

  if (s.unit === 'page') {
    const u = s.reference.units.find((u) => u.page === s.ref_page);
    if (!u) { console.error('no reference page', s.id, s.ref_page); continue; }
    const ref = normCoptic(u.extant), refAll = normCoptic(u.text);
    row.ref_letters = ref.length; row.ref_supplied_letters = refAll.length - ref.length;
    for (const a of ARMS) {
      if (!norm[a]) { row.arms[a] = null; continue; }
      const dist = levenshtein(ref, norm[a]);
      row.arms[a] = { ...info[a], dist, cer: dist / ref.length, read_letters: norm[a].length, mix: mix[a] };
    }
  } else {
    const units = (priv.get(s.id) ?? s.reference.units).map((u, i) => ({ ...u, i, n: normCoptic(u.text) })).filter((u) => u.n.length >= MIN_LETTERS);
    if (!units[0]?.text) { console.error('reference text unavailable (private dir missing?)', s.id); continue; }
    const per = units.map((u) => Object.fromEntries(ARMS.filter((a) => norm[a]).map((a) => [a, infixDistance(u.n, norm[a]).dist])));
    const hit = units.map((u, k) => Object.values(per[k]).some((d) => d / u.n.length < MATCH));
    // Longest contiguous run of matched verses, allowing one unmatched verse inside the run.
    let best = [0, -1];
    for (let i = 0; i < units.length; i++) {
      if (!hit[i]) continue;
      let j = i, last = i, gap = 0;
      while (j + 1 < units.length && (hit[j + 1] || gap < 1)) { j++; if (hit[j]) { last = j; gap = 0; } else gap++; }
      if (last - i > best[1] - best[0]) best = [i, last];
    }
    const span = units.slice(best[0], best[1] + 1), spanPer = per.slice(best[0], best[1] + 1);
    row.verses = span.map((u) => u.id); row.ref_letters = span.reduce((n, u) => n + u.n.length, 0);
    for (const a of ARMS) {
      if (!norm[a]) { row.arms[a] = null; continue; }
      const dist = spanPer.reduce((n, p) => n + p[a], 0);
      row.arms[a] = { ...info[a], dist, cer: dist / row.ref_letters, read_letters: norm[a].length, mix: mix[a], verse_cer: span.map((u, k) => +(spanPer[k][a] / u.n.length).toFixed(3)) };
    }
  }
  pages.push(row);
}

// Deterministic page bootstrap (mulberry32) of the pooled, letter-weighted CER.
const rng = ((a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; })(5778);
function summarise(rows, arm) {
  const xs = rows.filter((r) => r.arms[arm]);
  if (!xs.length) return null;
  const pooled = (set) => set.reduce((n, r) => n + r.arms[arm].dist, 0) / set.reduce((n, r) => n + r.ref_letters, 0);
  const boots = Array.from({ length: 5000 }, () => pooled(Array.from({ length: xs.length }, () => xs[Math.floor(rng() * xs.length)]))).sort((a, b) => a - b);
  const cers = xs.map((r) => r.arms[arm].cer).sort((a, b) => a - b);
  const r4 = (x) => +x.toFixed(4);
  return { n: xs.length, letters: xs.reduce((n, r) => n + r.ref_letters, 0), pooled_cer: r4(pooled(xs)), ci95: [r4(boots[125]), r4(boots[4874])], median: r4(cers[Math.floor((cers.length - 1) / 2)]), min: r4(cers[0]), max: r4(cers[cers.length - 1]) };
}
const groups = { all: pages, manuscript: pages.filter((p) => p.stratum === 'manuscript'), printed: pages.filter((p) => p.stratum === 'printed'), 'shared (all three engines)': pages.filter((p) => ARMS.every((a) => p.arms[a])) };
const summary = Object.fromEntries(Object.entries(groups).map(([g, rows]) => [g, Object.fromEntries(ARMS.map((a) => [a, summarise(rows, a)]))]));
const spend = reads.reduce((n, r) => n + (r.cost_usd || 0), 0);

fs.writeFileSync(path.join(OUT, 'scores.json'), JSON.stringify({ rule: 'NFD, drop all combining marks, lowercase, Greek-block letters folded to Coptic twins, keep Coptic letters only (no spaces/punctuation/digits/Latin)', match_threshold: MATCH, spend_usd: +spend.toFixed(4), summary, pages }, null, 1) + '\n');

const pct = (x) => (x == null ? '—' : (x * 100).toFixed(1) + '%');
console.log('page                 stratum     ref   stored   lite    flash   (letter mix flash c/g/l)');
for (const p of pages) console.log(p.id.padEnd(20), p.stratum.padEnd(10), String(p.ref_letters).padStart(5), ...ARMS.map((a) => pct(p.arms[a]?.cer).padStart(7)), ARMS.map((a) => p.arms[a] ? `${a[0]}:${p.arms[a].mix.coptic}/${p.arms[a].mix.greek}/${p.arms[a].mix.latin}` : '').join(' '), p.verses ? `[${p.verses[0]}…${p.verses.at(-1)} n=${p.verses.length}]` : '');
for (const [g, v] of Object.entries(summary)) for (const a of ARMS) if (v[a]) console.log(g.padEnd(28), a.padEnd(7), `n=${v[a].n}`, `pooled ${pct(v[a].pooled_cer)}`, `CI ${pct(v[a].ci95[0])}–${pct(v[a].ci95[1])}`, `median ${pct(v[a].median)}`, `range ${pct(v[a].min)}–${pct(v[a].max)}`);
console.log(`spend $${spend.toFixed(4)}`);
