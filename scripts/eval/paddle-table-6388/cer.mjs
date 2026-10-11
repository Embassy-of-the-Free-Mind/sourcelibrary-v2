// PRIOR ART: see README.md in this directory (#6388 table detector + bake-off; scratch-run stage, run from $JOB_SCRATCH/w).
import fs from 'fs';
import { bodyText, foldHan, bodyCer } from '../ground-truth-5935/lib.mjs';
const B = JSON.parse(fs.readFileSync('bake.json'));
const L = fs.readFileSync('labels.jsonl', 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const A = Object.fromEntries(fs.readFileSync('align.jsonl', 'utf8').split('\n').filter(Boolean).map(JSON.parse).map(a => [a.key, a]));
const last = f => { const m = {}; for (const l of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); m[r.uid] = r; } return m; };
const O = last('read-opus.jsonl'), G = last('read-gem.jsonl');
const rows = [];
for (const b of B) {
  const paddle = (L.find(r => r.key === b.key && r.set === 'contained') || L.find(r => r.key === b.key)).text;
  const a = A[b.key]; const row = { uid: b.uid, key: b.key, stratum: b.stratum, title: b.title, kanripo: a?.status === 'aligned' ? { pb: a.ref_pb, leaf: a.leaf, chars: a.kanripo_text.length } : null };
  for (const [arm, t] of [['paddle', paddle], ['opus', O[b.uid]?.text || ''], ['gemini', G[b.uid]?.text || '']]) {
    const q = foldHan(bodyText(t)); row[arm + '_han'] = [...q].length;
    if (a?.status === 'aligned' && a.kanripo_text.length >= 20) { const W = a.kanripo_text; const s = bodyCer(q, W, { expected: [...W].length }); row[arm + '_cer'] = +s.cer.toFixed(4); }
  }
  rows.push(row);
}
fs.writeFileSync('cer.json', JSON.stringify(rows, null, 1));
for (const r of rows) console.log(r.uid, r.stratum.padEnd(21), r.kanripo ? String(r.kanripo.chars).padStart(4) : '   -', ['paddle', 'opus', 'gemini'].map(a => `${a} ${r[a + '_han']}${r[a + '_cer'] != null ? '/' + (100 * r[a + '_cer']).toFixed(1) + '%' : ''}`).join('  '));
const med = xs => { const a = xs.filter(x => x != null).sort((x, y) => x - y); return a.length ? a[Math.floor((a.length - 1) / 2)] : null; };
const K = rows.filter(r => r.paddle_cer != null);
for (const arm of ['paddle', 'opus', 'gemini']) { const xs = K.map(r => r[arm + '_cer']); console.log(arm, 'n', xs.length, 'median CER', (100 * med(xs)).toFixed(1), 'mean', (100 * xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1), 'pages CER>=0.5', xs.filter(x => x >= 0.5).length); }
// order-free: multiset of Han vs the Kanripo leaf. excess = written beyond what the leaf prints (invention proxy), missing = printed but absent
const bag = s => { const m = new Map(); for (const c of s) m.set(c, (m.get(c) || 0) + 1); return m; };
const A2 = A; const out2 = [];
for (const r of rows) {
  const a = A2[r.key]; if (!(a?.status === 'aligned' && a.kanripo_text.length >= 20)) continue;
  const W = bag(a.kanripo_text); const n = [...a.kanripo_text].length;
  const b = B.find(x => x.uid === r.uid);
  const paddle = (L.find(x => x.key === b.key && x.set === 'contained') || L.find(x => x.key === b.key)).text;
  const texts = { paddle, opus: O[r.uid]?.text || '', gemini: G[r.uid]?.text || '' };
  const allBad = ['paddle', 'opus', 'gemini'].every(k => r[k + '_cer'] >= 0.9);
  const o = { uid: r.uid, stratum: r.stratum, kchars: n, leaf_covers: !allBad };
  for (const [k, t] of Object.entries(texts)) { const Q = bag(foldHan(bodyText(t))); let ex = 0, mi = 0; for (const [c, v] of Q) ex += Math.max(0, v - (W.get(c) || 0)); for (const [c, v] of W) mi += Math.max(0, v - (Q.get(c) || 0)); o[k] = { cer: r[k + '_cer'], excess: ex, missing: mi, excess_pct: +(100 * ex / n).toFixed(1), empty: !t.trim() }; }
  out2.push(o);
}
fs.writeFileSync('bag.json', JSON.stringify(out2, null, 1));
for (const o of out2) console.log(o.uid, o.stratum.padEnd(21), String(o.kchars).padStart(4), o.leaf_covers ? '   ' : 'NOC', ['paddle', 'opus', 'gemini'].map(k => `${k} +${o[k].excess}/-${o[k].missing} cer${(100 * o[k].cer).toFixed(0)}`).join('  '));
const C = out2.filter(o => o.leaf_covers);
for (const k of ['paddle', 'opus', 'gemini']) { const xs = C.filter(o => !o[k].empty); const ex = xs.reduce((a, o) => a + o[k].excess, 0), kc = xs.reduce((a, o) => a + o.kchars, 0); const cers = xs.map(o => o[k].cer).sort((a, b) => a - b); console.log(k, 'covered pages', xs.length, 'of', C.length, 'excess chars', ex, 'per 100 printed', (100 * ex / kc).toFixed(1), 'pages with excess>=3', xs.filter(o => o[k].excess >= 3).length, 'median CER', (100 * cers[Math.floor((cers.length - 1) / 2)]).toFixed(1)); }
// over-count: repeats of characters the leaf DOES print, beyond its count (the inflation failure; misreads excluded)
const over = [];
for (const o of out2) { if (!o.leaf_covers) continue; const a = A2[o.key || rows.find(r => r.uid === o.uid).key]; const W = bag(a.kanripo_text); const b = B.find(x => x.uid === o.uid);
  const paddle = (L.find(x => x.key === b.key && x.set === 'contained') || L.find(x => x.key === b.key)).text;
  const texts = { paddle, opus: O[o.uid]?.text || '', gemini: G[o.uid]?.text || '' }; const row = { uid: o.uid, stratum: o.stratum, kchars: o.kchars };
  for (const [k, t] of Object.entries(texts)) { if (!t.trim()) { row[k] = null; continue; } const Q = bag(foldHan(bodyText(t))); let oc = 0; for (const [c, w] of W) oc += Math.max(0, (Q.get(c) || 0) - w); row[k] = oc; }
  over.push(row); }
fs.writeFileSync('overcount.json', JSON.stringify(over, null, 1));
for (const r of over) console.log('OC', r.uid, r.stratum.padEnd(21), r.kchars, 'paddle', r.paddle, 'opus', r.opus, 'gemini', r.gemini);
for (const k of ['paddle', 'opus', 'gemini']) { const xs = over.filter(r => r[k] != null); console.log('OC', k, 'pages', xs.length, 'over-count chars', xs.reduce((a, r) => a + r[k], 0), 'pages >=3', xs.filter(r => r[k] >= 3).length); }
