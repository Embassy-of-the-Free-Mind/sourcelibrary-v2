#!/usr/bin/env node
// #6740 read-surface, Amendment 6 (second form): the stage-1 screening design. A Definitive Screening Design (Jones and
// Nachtsheim 2011, J. Quality Technology 43:1–15) with two two-level categorical factors (Jones and Nachtsheim 2013,
// J. Quality Technology 45:121–129): rows C and −C of a conference matrix of order 6, the first five columns, the zeros of
// a categorical column set to +1 in C's row and −1 in its fold-over, plus two runs with every continuous factor at its
// centre and the categorical factors at (+1, −1) and (−1, +1). 2·6 + 2 = 14 runs a language.
//
// PRIOR ART: run.mjs (this directory: the Box-Behnken list, hand-written, and its shuffle); nothing in the repo builds a
//   screening design. The conference matrix is Paley's construction for q = 5 (q ≡ 1 mod 4): C = [[0, 1ᵀ], [1, Q]],
//   Q the Jacobsthal matrix χ(j − i) over GF(5), symmetric; Cᵀ C = 5 I is checked below.
//
//   node scripts/eval/read-surface-6740/dsd.mjs > scripts/eval/read-surface-6740/design-dsd.json            (second form)
//   node scripts/eval/read-surface-6740/dsd.mjs --form=3 > scripts/eval/read-surface-6740/design-dsd3.json  (third form)
// Third form: 3 continuous + 1 categorical (the prompt line): a skew conference matrix of order 4 (C = [[0,1,1,1],
// [−1,0,1,−1],[−1,−1,0,1],[−1,1,−1,0]], CᵀC = 3I), rows C and −C, all four columns, plus two continuous-centre runs:
// 2·4 + 2 = 10 settings.
const FORM3 = process.argv.includes('--form=3');
const q = FORM3 ? 3 : 5;
const chi = (a) => { a = ((a % q) + q) % q; if (a === 0) return 0; for (let x = 1; x < q; x++) if ((x * x) % q === a) return 1; return -1; };
const C = FORM3 ? [[0, 1, 1, 1], [-1, 0, 1, -1], [-1, -1, 0, 1], [-1, 1, -1, 0]]
  : Array.from({ length: q + 1 }, (_, i) => Array.from({ length: q + 1 }, (_, j) => (i === 0 && j === 0 ? 0 : i === 0 || j === 0 ? 1 : chi(j - i))));
for (let i = 0; i <= q; i++) for (let j = 0; j <= q; j++) { const s = C.reduce((t, r) => t + r[i] * r[j], 0); if (s !== (i === j ? q : 0)) throw new Error(`not a conference matrix at ${i},${j}: ${s}`); }

const FACTORS = [
  { key: 'ppc', name: 'pages a call', kind: 'continuous', levels: [1, 4, 8] },
  { key: 'edge', name: 'image long edge (px)', kind: 'continuous', levels: [1024, 1600, 2400] },
  { key: 'think', name: 'thinking', kind: 'continuous (ordinal)', levels: ['low', 'medium', 'high'] },
  { key: 'prompt', name: 'prompt', kind: 'categorical', levels: ['live', 'live + script line'] },
  ...(FORM3 ? [] : [{ key: 'prep', name: 'image prep', kind: 'categorical', levels: ['as served', 'grayscale + normalise + unsharp'] }]),
];
const K = FACTORS.length;
const CAT = FORM3 ? [3] : [3, 4];
const rows = [];
for (const sign of [1, -1]) for (const r of C) rows.push(r.slice(0, K).map((v, j) => (CAT.includes(j) && v === 0 ? sign : sign * v)));
if (FORM3) rows.push([0, 0, 0, -1], [0, 0, 0, 1]); else rows.push([0, 0, 0, 1, -1], [0, 0, 0, -1, 1]);

// Main-effect correlations (the design's own check).
const n = rows.length, cols = rows[0].length;
const corr = Array.from({ length: cols }, (_, a) => Array.from({ length: cols }, (_, b) => {
  const xa = rows.map((r) => r[a]), xb = rows.map((r) => r[b]);
  const ma = xa.reduce((s, x) => s + x, 0) / n, mb = xb.reduce((s, x) => s + x, 0) / n;
  const c = xa.reduce((s, x, i) => s + (x - ma) * (xb[i] - mb), 0), va = xa.reduce((s, x) => s + (x - ma) ** 2, 0), vb = xb.reduce((s, x) => s + (x - mb) ** 2, 0);
  return +(c / Math.sqrt(va * vb)).toFixed(3);
}));
// Shuffled run order per language (seed 6740, the run.mjs mulberry32).
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const r = rng(6740);
const ids = rows.map((_, i) => `${FORM3 ? 'T' : 'S'}${String(i + 1).padStart(2, '0')}`);
const order = {};
for (const lang of ['de', 'la', 'en']) { const a = [...ids]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } order[lang] = a; }
const runs = rows.map((x, i) => ({ id: ids[i], x, ...Object.fromEntries(FACTORS.map((f, j) => [f.key, f.kind === 'categorical' ? f.levels[(x[j] + 1) / 2] : f.levels[x[j] + 1]])) }));
console.log(JSON.stringify({
  design: FORM3 ? 'Definitive Screening Design, 3 three-level continuous + 1 two-level categorical factor (Jones & Nachtsheim 2011, 2013)' : 'Definitive Screening Design, 3 three-level continuous + 2 two-level categorical factors (Jones & Nachtsheim 2011, 2013)',
  construction: FORM3 ? 'skew conference matrix of order 4; rows C and −C; the categorical zero +1 in C, −1 in −C; two continuous-centre runs with the prompt line off and on' : 'conference matrix of order 6 (Paley, GF(5)); rows C and −C, columns 1–5; categorical zeros +1 in C, −1 in −C; two centre runs with categorical (+1,−1), (−1,+1)',
  conference_matrix: C, factors: FACTORS, runs, main_effect_correlation: corr, run_order: order, seed: 6740,
}, null, 1));
