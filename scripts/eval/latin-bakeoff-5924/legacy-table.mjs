#!/usr/bin/env node
// PRIOR ART: scripts/eval/latin-bakeoff-5924/bar-a5.mjs (reads score.mjs --out JSON; bootstrap copied from score.mjs).
/**
 * legacy-table.mjs — prereg Amendment 5a: the holding library's legacy OCR (arm X) beside lite, LP and the engines,
 * on the subset of leaves that have a legacy text. Descriptive: no bar.
 *
 *   node legacy-table.mjs <results.json> <legacy-log.jsonl> [--fold <results-fold-f.json>] [--out legacy.json]
 * Mapping check: a page is dropped as "mapping uncertain" when leaf k−1 (Xm1) or k+1 (Xp1) scores > 0.30 CER better than k.
 */
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : null; };
const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const res = load(args[0]), fold = opt('fold') ? load(opt('fold')) : null;
const log = fs.readFileSync(args[1], 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const ARMS = ['X', 'L', 'LP', 'F', 'Gr', 'Or', 'Mr', 'P1r', 'P0r'];
const median = (xs) => { const s = [...xs].sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function bootCI(xs) { const r = mulberry32(5924), n = xs.length, m = []; for (let b = 0; b < 10000; b++) { const s = []; for (let i = 0; i < n; i++) s.push(xs[Math.floor(r() * n)]); m.push(median(s)); } m.sort((a, b) => a - b); return [m[250], m[9750]]; }
const pct = (x) => (x == null ? '' : (100 * x).toFixed(2));

const bySlug = new Map(log.map((r) => [r.page_id, r]));
const pages = res.pages.filter((p) => bySlug.get(p.slug)?.status === 'ok');
const foldBy = fold ? new Map(fold.pages.map((p) => [p.slug, p])) : null;
const dropped = [], kept = [];
for (const p of pages) {
  const k = p.arms.X.N, m1 = p.arms.Xm1?.N ?? 1, p1 = p.arms.Xp1?.N ?? 1;
  (Math.min(m1, p1) < k - 0.30 ? dropped : kept).push(p);
}
const out = { prereg: 'PREREGISTRATION-open-engine-print-5660.md Amendment 5a (descriptive)', counts: {}, cells: {} };
for (const r of log) { const key = `${r.source}|${r.century}|${r.status}`; out.counts[key] = (out.counts[key] || 0) + 1; }
out.mapping_uncertain = dropped.map((p) => ({ slug: p.slug, X: p.arms.X.N, Xm1: p.arms.Xm1?.N, Xp1: p.arms.Xp1?.N }));
for (const cent of ['1600s', '1500s']) for (const src of ['all', 'archive', 'mdz', 'e-rara']) {
  const P = kept.filter((p) => p.century === cent && (src === 'all' || bySlug.get(p.slug).source === src));
  if (!P.length) continue;
  const cell = { n: P.length, arms: {} };
  for (const a of ARMS) {
    if (!P[0].arms[a]) continue;
    const xs = P.map((p) => p.arms[a].N);
    cell.arms[a] = { median_N: median(xs), ci: bootCI(xs), catastrophic: P.filter((p) => p.arms[a].catastrophic).length,
      median_fold_f: foldBy ? median(P.map((p) => foldBy.get(p.slug).arms[a].N)) : null };
  }
  out.cells[`${cent}|${src}`] = cell;
}
if (opt('out')) fs.writeFileSync(opt('out'), JSON.stringify(out, null, 1) + '\n');
console.log('counts', out.counts);
console.log(`mapping uncertain (dropped): ${dropped.length}`, out.mapping_uncertain);
for (const [k, c] of Object.entries(out.cells)) {
  console.log(`\n${k} (n=${c.n})`);
  for (const [a, s] of Object.entries(c.arms)) console.log([a, pct(s.median_N), `[${pct(s.ci[0])}, ${pct(s.ci[1])}]`, `cat ${s.catastrophic}`, `fold-f ${pct(s.median_fold_f)}`].join('\t'));
}
