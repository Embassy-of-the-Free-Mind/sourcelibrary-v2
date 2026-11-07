#!/usr/bin/env node
// PRIOR ART: yig_leaf_worker.py repetition_score / hard_loop (the Yigdzin loop guard: 8-syllable shingles), the #4523
// step-2 decision classes (`duplication`, `fewer-lines`, `fewer-syllables`: they compared a leaf read with the
// whole-page read and KEPT the longer, which is how the seam inventions stayed served), scripts/lib/leaf-break.mjs
// (seam bridging in translations, not OCR). None is a $0 check on a STORED read alone that says "this frame's seam is
// damaged, re-read it". This is that check (Derek's note on #5771, 2026-10-25, part B).
/**
 * triage.mjs — $0, no model. Seam-damage check for a stored multi-leaf Yigdzin read.
 *   features --frames=frames.jsonl --req=<6948>/audit/req.jsonl --out=features.jsonl
 *   fit      --features=features.jsonl --labels=labels.json --out=triage.json
 *
 * Features (from the stored transcription and the ledger's per-leaf line counts only):
 *   line_excess   stored lines − ledger lines (sum), signed; 0 when there is no ledger
 *   seg_mismatch  leaves whose line count differs from the ledger's for that leaf (leaf-break reads)
 *   dup_line      the highest syllable-trigram Jaccard between any two lines (a copied line ≈ 1)
 *   dup_seam      the same, for line pairs within 2 lines of a seam (the leaf-break, or the ledger's cut line)
 *   rep           the highest 8-syllable-shingle repetition score of any leaf (the Yigdzin loop measure)
 *   short_frac    share of lines (not counting each leaf's last line) under half the median line length
 *   whole_read    the stored read is a whole-page read (`ocr.engine.read_mode: page`; free metadata, not text)
 *   asym          syllables of the shortest leaf / the longest (1 = even)
 * `fit`: the rule flags a frame when any feature passes its threshold. Thresholds are chosen on the training frames
 * only (each threshold from a small grid, greedily, maximising Youden's J), and every frame is predicted by the rule
 * fitted WITHOUT its book (leave-one-book-out; here one frame per book). Reports sensitivity and specificity with
 * Wilson intervals, the fixed rule fitted on all frames, and each feature alone.
 */
import fs from 'node:fs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const CMD = process.argv[2];
const TSHEG = '་';
const syl = (t) => t.replace(/\n/g, TSHEG).split(TSHEG).map((s) => s.trim()).filter(Boolean);
const tri = (l) => { const s = syl(l); const out = new Set(); for (let i = 0; i + 2 < s.length; i++) out.add(s.slice(i, i + 3).join(TSHEG)); return out; };
const jac = (a, b) => { if (!a.size || !b.size) return 0; let k = 0; for (const x of a) if (b.has(x)) k++; return k / (a.size + b.size - k); };
function rep(t, n = 8) { const s = syl(t); if (s.length < n + 1) return 0; const sh = []; for (let i = 0; i + n <= s.length; i++) sh.push(s.slice(i, i + n).join(TSHEG)); return 1 - new Set(sh).size / sh.length; }

export function features(text, ledger) {
  let leaves = text.split(/\n?<leaf-break\s*\/>\n?/).map((x) => x.split('\n').filter((l) => l.trim()));
  const marked = leaves.length > 1;
  const lines = leaves.flat();
  // a whole-page read: its leaves are where the ledger's line counts put them (the #5260 backfill's cut)
  if (!marked && ledger?.length > 1) { const lv = []; let i = 0; ledger.forEach((n, k) => { lv.push(lines.slice(i, k === ledger.length - 1 ? lines.length : i + n)); i += n; }); leaves = lv.filter((x) => x.length); }
  const L = ledger?.length ? ledger.reduce((a, b) => a + b, 0) : null;
  // seam positions (line index where a new leaf starts): from the markers, else from the ledger's counts
  const seams = [];
  { let i = 0; for (const lv of leaves.slice(0, -1)) { i += lv.length; seams.push(i); } }
  const T = lines.map(tri);
  let dup = 0, dupSeam = 0;
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
    const v = jac(T[i], T[j]); dup = Math.max(dup, v);
    if (seams.some((s) => Math.abs(i - s) <= 2 && Math.abs(j - s) <= 2)) dupSeam = Math.max(dupSeam, v);
  }
  const lens = lines.map((l) => syl(l).length), med = [...lens].sort((a, b) => a - b)[Math.floor(lens.length / 2)] || 0;
  let k = 0, short = 0, cnt = 0;
  for (const lv of leaves) { lv.forEach((l, i) => { if (i < lv.length - 1) { cnt++; if (lens[k] < med / 2) short++; } k++; }); }
  const sylLeaf = leaves.map((lv) => syl(lv.join('\n')).length);
  return {
    leaves: leaves.length, lines: lines.length, ledger_lines: L,
    line_excess: L == null ? 0 : lines.length - L,
    seg_mismatch: marked && ledger?.length === leaves.length ? leaves.filter((lv, i) => lv.length !== ledger[i]).length : 0,
    dup_line: +dup.toFixed(3), dup_seam: +dupSeam.toFixed(3),
    rep: +Math.max(...leaves.map((lv) => rep(lv.join('\n')))).toFixed(3),
    short_frac: cnt ? +(short / cnt).toFixed(3) : 0,
    asym: sylLeaf.length > 1 ? +(Math.min(...sylLeaf) / Math.max(...sylLeaf, 1)).toFixed(3) : 1,
  };
}

// Each feature's direction and threshold grid: "flag when value ≥ t" (or ≤ t for asym).
const GRID = {
  whole_read: { get: (f) => (f.read_mode === 'page' ? 1 : 0), ts: [1] },
  line_excess_abs: { get: (f) => Math.abs(f.line_excess), ts: [1, 2, 3] },
  seg_mismatch: { get: (f) => f.seg_mismatch, ts: [1, 2] },
  dup_line: { get: (f) => f.dup_line, ts: [0.3, 0.4, 0.5, 0.6, 0.7, 0.8] },
  dup_seam: { get: (f) => f.dup_seam, ts: [0.2, 0.3, 0.4, 0.5, 0.6] },
  rep: { get: (f) => f.rep, ts: [0.03, 0.05, 0.08, 0.1, 0.15] },
  short_frac: { get: (f) => f.short_frac, ts: [0.1, 0.2, 0.3, 0.5] },
  asym: { get: (f) => 1 - f.asym, ts: [0.2, 0.3, 0.4, 0.5] },
};
const wilson = (k, n, z = 1.96) => { if (!n) return [null, null]; const p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d; return [+Math.max(0, c - h).toFixed(3), +Math.min(1, c + h).toFixed(3)]; };
const flag = (rule, f) => Object.entries(rule).some(([k, t]) => GRID[k].get(f) >= t);
function score(rows, pred) {
  const tp = rows.filter((r, i) => r.y && pred[i]).length, fn = rows.filter((r, i) => r.y && !pred[i]).length;
  const tn = rows.filter((r, i) => !r.y && !pred[i]).length, fp = rows.filter((r, i) => !r.y && pred[i]).length;
  return { tp, fn, tn, fp, sensitivity: tp + fn ? +(tp / (tp + fn)).toFixed(3) : null, sens_ci95: wilson(tp, tp + fn), specificity: tn + fp ? +(tn / (tn + fp)).toFixed(3) : null, spec_ci95: wilson(tn, tn + fp), flagged: tp + fp, n: rows.length };
}
/** Greedy OR-rule: add the (feature, threshold) that most raises Youden's J; stop when nothing raises it; ≤ 3 terms. */
function fitRule(rows) {
  const J = (rule) => { const s = score(rows, rows.map((r) => flag(rule, r.f))); return (s.sensitivity ?? 0) + (s.specificity ?? 0) - 1; };
  let rule = {}, best = J(rule);
  for (let step = 0; step < 3; step++) {
    let cand = null;
    for (const [k, g] of Object.entries(GRID)) { if (k in rule) continue; for (const t of g.ts) { const r2 = { ...rule, [k]: t }, j = J(r2); if (j > best + 1e-9) { best = j; cand = r2; } } }
    if (!cand) break; rule = cand;
  }
  return rule;
}

if (CMD === 'features') {
  const frames = fs.readFileSync(arg('frames'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const seam = new Map(fs.readFileSync(arg('req'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map((r) => [r.uid, r.prompt.split('TRANSCRIPTION:\n')[1].split('\n\nENGLISH:\n')[0]]));
  const out = frames.filter((f) => seam.has(f.uid)).map((f) => ({ uid: f.uid, book_id: f.book_id, read_mode: f.stored.read_mode, ...features(seam.get(f.uid), f.ledger_leaf_lines) }));
  fs.writeFileSync(arg('out'), out.map((x) => JSON.stringify(x)).join('\n') + '\n');
  console.log(`${out.length} frames; features written`);
}

if (CMD === 'fit') {
  const feats = new Map(fs.readFileSync(arg('features'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map((f) => [f.uid, f]));
  const labels = JSON.parse(fs.readFileSync(arg('labels'), 'utf8'));   // {label_name: {uid: 0|1}}
  const res = {};
  for (const [name, lab] of Object.entries(labels)) {
    const rows = Object.entries(lab).filter(([u]) => feats.has(u)).map(([u, y]) => ({ uid: u, book: feats.get(u).book_id, y: !!y, f: feats.get(u) }));
    const books = [...new Set(rows.map((r) => r.book))];
    const pred = rows.map((r) => flag(fitRule(rows.filter((x) => x.book !== r.book)), r.f));
    const full = fitRule(rows);
    res[name] = { positives: rows.filter((r) => r.y).length, n: rows.length, books: books.length, lobo: score(rows, pred), rule_on_all: full, in_sample: score(rows, rows.map((r) => flag(full, r.f))),
      single_features: Object.fromEntries(Object.entries(GRID).map(([k, g]) => { const t = fitRule(rows)[k] ?? g.ts[0]; return [`${k}>=${t}`, score(rows, rows.map((r) => g.get(r.f) >= t))]; })),
      missed_lobo: rows.filter((r, i) => r.y && !pred[i]).map((r) => r.uid), false_flags_lobo: rows.filter((r, i) => !r.y && pred[i]).map((r) => r.uid) };
  }
  fs.writeFileSync(arg('out'), JSON.stringify(res, null, 1));
  console.log(JSON.stringify(Object.fromEntries(Object.entries(res).map(([k, v]) => [k, { pos: v.positives, n: v.n, rule: v.rule_on_all, lobo: v.lobo }])), null, 1));
}
