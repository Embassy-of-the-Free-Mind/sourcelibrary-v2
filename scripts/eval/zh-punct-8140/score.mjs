// PRIOR ART: scripts/eval/lib/paired-stats.mjs (bootstrap helpers; this needs a micro-pooled F1 over resampled books,
// which bootstrapCI's mean-of-items does not give, so the resampling is done here with lib.mulberry32), lib/agreement-stats
// wilson (imported). Scores only; it writes no text of the source.
/**
 * #8140 score frame A. node score.mjs --priv=DIR --arms=G,O[,G2] [--out=FILE]
 */
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { breaksOf, stripForInput, guard, repairBreaks, prf, f1Of, mulberry32 } from './lib.mjs';
import { wilson } from '../lib/agreement-stats.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const argOf = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const PRIV = path.join(argOf('priv'), 'A'); const ARMS = argOf('arms', 'G,O').split(',');
const draw = JSON.parse(fs.readFileSync(path.join(here, 'draw-A.json'), 'utf8')).pages;
const B = 2000;
const rows = [];
for (const d of draw) {
  const keyText = fs.readFileSync(path.join(PRIV, `${d.slug}.key.txt`), 'utf8');
  const key = breaksOf(keyText); const input = key.chars;
  const marks = [...keyText].filter((x) => /\p{P}/u.test(x) && !'（）'.includes(x)).length;
  if (marks / d.han < 0.02) continue;
  const style = keyText.includes('，') ? 'modern' : 'period-only';
  const row = { slug: d.slug, page_id: d.page_id, book_id: d.book_id, style, siku: d.siku_wudeng, n: key.n, key_any: key.any.size, key_final: key.final.size, arms: {} };
  for (const arm of ARMS) {
    const f = path.join(PRIV, `out-${arm}`, `${d.slug}.json`);
    if (!fs.existsSync(f)) continue;
    const o = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!o.answer) { row.arms[arm] = { empty: true, calls: o.calls, seconds: o.seconds }; continue; }
    const g = guard(input, o.answer);
    const K = repairBreaks(input, o.answer);
    const R = g.same ? { any: g.breaks.any, final: g.breaks.final } : { any: new Set(), final: new Set() };
    const sc = (s) => ({ any: prf(key.any, s.any), final: prf(key.final, s.final) });
    row.arms[arm] = { changed: !g.same, in_len: g.inLen, out_len: g.outLen, matched: K.matched, calls: o.calls, seconds: o.seconds, usage_in: o.usage?.input_tokens ?? null, usage_out: o.usage?.output_tokens ?? null, K: sc(K), R: sc(R), pred_any: K.any.size, sets: { any: [...K.any], final: [...K.final] } };
  }
  rows.push(row);
}
const pool = (rs, arm, pol, lvl) => { const t = { tp: 0, fp: 0, fn: 0 }; for (const r of rs) { const a = r.arms[arm]; const s = a && !a.empty ? a[pol][lvl] : { tp: 0, fp: 0, fn: r[lvl === 'any' ? 'key_any' : 'key_final'] }; t.tp += s.tp; t.fp += s.fp; t.fn += s.fn; } return t; };
const r3 = (x) => Math.round(x * 1000) / 1000;
function stat(rs, arm, pol, lvl) {
  const pt = f1Of(pool(rs, arm, pol, lvl));
  const rng = mulberry32(8140); const fs1 = [];
  for (let b = 0; b < B; b++) { const s = Array.from({ length: rs.length }, () => rs[Math.floor(rng() * rs.length)]); fs1.push(f1Of(pool(s, arm, pol, lvl)).f1); }
  fs1.sort((a, b) => a - b);
  return { n: rs.length, p: r3(pt.p), r: r3(pt.r), f1: r3(pt.f1), ci: [r3(fs1[Math.floor(B * 0.025)]), r3(fs1[Math.floor(B * 0.975)])] };
}
function delta(rs, a1, a2, pol, lvl) {
  const rng = mulberry32(8140); const ds = [];
  for (let b = 0; b < B; b++) { const s = Array.from({ length: rs.length }, () => rs[Math.floor(rng() * rs.length)]); ds.push(f1Of(pool(s, a1, pol, lvl)).f1 - f1Of(pool(s, a2, pol, lvl)).f1); }
  ds.sort((a, b) => a - b);
  return { d: r3(f1Of(pool(rs, a1, pol, lvl)).f1 - f1Of(pool(rs, a2, pol, lvl)).f1), ci: [r3(ds[Math.floor(B * 0.025)]), r3(ds[Math.floor(B * 0.975)])] };
}
const strata = { all: rows, modern: rows.filter((r) => r.style === 'modern'), period_only: rows.filter((r) => r.style === 'period-only'), siku_wudeng: rows.filter((r) => r.siku), non_siku: rows.filter((r) => !r.siku) };
const out = { issue: 8140, scored_pages: rows.length, arms: {} };
for (const arm of ARMS) {
  const rs = rows.filter((r) => r.arms[arm]);
  if (!rs.length) continue;
  const ch = rs.filter((r) => r.arms[arm].changed).length, em = rs.filter((r) => r.arms[arm].empty).length;
  const w = wilson(ch, rs.length);
  const A = { pages: rs.length, empty: em, changed_before_guard: ch, changed_rate: r3(ch / rs.length), changed_ci: [r3(w.lo ?? w[0] ?? 0), r3(w.hi ?? w[1] ?? 0)],
    calls: rs.reduce((s, r) => s + (r.arms[arm].calls || 0), 0), median_seconds: r3(rs.map((r) => r.arms[arm].seconds).sort((a, b) => a - b)[rs.length >> 1]),
    total_seconds: r3(rs.reduce((s, r) => s + r.arms[arm].seconds, 0)), chars: rs.reduce((s, r) => s + r.n, 0), cells: {} };
  for (const [sn, srs0] of Object.entries(strata)) { const srs = srs0.filter((r) => r.arms[arm]); if (!srs.length) continue; A.cells[sn] = { any_K: stat(srs, arm, 'K', 'any'), final_K: stat(srs, arm, 'K', 'final'), any_R: stat(srs, arm, 'R', 'any'), final_R: stat(srs, arm, 'R', 'final') }; }
  out.arms[arm] = A;
}
if (ARMS.includes('G') && ARMS.includes('O')) {
  const rs = rows.filter((r) => r.arms.G && r.arms.O);
  out.paired_G_minus_O = { n: rs.length, final_K_modern: delta(rs.filter((r) => r.style === 'modern'), 'G', 'O', 'K', 'final'), any_K_all: delta(rs, 'G', 'O', 'K', 'any') };
}
if (ARMS.includes('G2')) {
  const rs = rows.filter((r) => r.arms.G && r.arms.G2 && !r.arms.G.empty && !r.arms.G2.empty);
  const agree = { any: { tp: 0, fp: 0, fn: 0 }, final: { tp: 0, fp: 0, fn: 0 } };
  for (const r of rs) for (const l of ['any', 'final']) { const a = new Set(r.arms.G.sets[l]), b = new Set(r.arms.G2.sets[l]); const s = prf(a, b); agree[l].tp += s.tp; agree[l].fp += s.fp; agree[l].fn += s.fn; }
  out.noise_floor_G_vs_G2 = { n: rs.length, agreement_f1_any: r3(f1Of(agree.any).f1), agreement_f1_final: r3(f1Of(agree.final).f1), G_any: stat(rs, 'G', 'K', 'any'), G2_any: stat(rs, 'G2', 'K', 'any'), G_final_modern: stat(rs.filter((r) => r.style === 'modern'), 'G', 'K', 'final'), G2_final_modern: stat(rs.filter((r) => r.style === 'modern'), 'G2', 'K', 'final'), delta_any: delta(rs, 'G2', 'G', 'K', 'any') };
}
const perPage = rows.map((r) => ({ slug: r.slug, page_id: r.page_id, book_id: r.book_id, style: r.style, siku: r.siku, n: r.n, key_any: r.key_any, key_final: r.key_final, arms: Object.fromEntries(Object.entries(r.arms).map(([k, v]) => [k, v.empty ? { empty: true } : { changed: v.changed, in_len: v.in_len, out_len: v.out_len, calls: v.calls, seconds: v.seconds, any_K: v.K.any, final_K: v.K.final, pred_any: v.pred_any }])) }));
const OUTF = argOf('out');
if (OUTF) { fs.writeFileSync(OUTF, JSON.stringify(out, null, 1)); fs.writeFileSync(OUTF.replace(/\.json$/, '-pages.jsonl'), perPage.map((x) => JSON.stringify(x)).join('\n') + '\n'); }
console.log(JSON.stringify(out, null, 1));
