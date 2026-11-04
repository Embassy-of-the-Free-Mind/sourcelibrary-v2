#!/usr/bin/env node
// PRIOR ART: controls.mjs (this directory; one tag's controls); lib/paired-stats.mjs makeRng (the cluster bootstrap's generator). Scores a whole collection from blind answers, referee and by-eye overrides.
// #6552. Prints numbers only: no text, so its output may be posted. Overrides: $JOB_SCRATCH/<c>/eye.json { id: class, ... }, the final arbiter on the items opened by eye.
//   node score.mjs --c=a --tags=a1,a2 --draw=draw-a2.json [--json=out.json] [--list=KEYING]  (--list prints items, with text: scratch only)
import fs from 'node:fs';
import path from 'node:path';
import { foldCh, mulberry } from './lib.mjs';
const arg = (n, d) => process.argv.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const ROOT = path.join(process.env.JOB_SCRATCH, arg('c')), TAGS = arg('tags').split(','), LIST = arg('list');
const draw = arg('draw') ? JSON.parse(fs.readFileSync(new URL(arg('draw'), import.meta.url))) : { picked: [] }, workOf = Object.fromEntries((draw.picked || []).map((p) => [p.uid, p.work || p.kr]));
const said = (it, v) => { if (!v) return null; if (v.choice === 'A') return it.swap ? 'ocr' : 'typed'; if (v.choice === 'B') return it.swap ? 'typed' : 'ocr'; return v.choice; };
export const classOf = (it, v) => {
  const s = said(it, v);
  if (s == null || s === 'cannot_tell') return 'CANNOT_TELL';
  if (s === 'typed') return v.variant ? 'OCR_VARIANT' : 'OCR_ERROR';
  if (s === 'ocr') return v.variant ? 'EDITORIAL_NORM' : v.slip ? 'EDITORIAL_CORR' : 'KEYING';
  return 'NEITHER';
};
// eye.json: opened by eye. eye-text.json: settled from the alignment itself, without the image: STRUCTURE (a running head or page edge aligned against text), DUP (the second half of one displaced character), a hand that does not separate a pair.
const readJ = (f) => fs.existsSync(path.join(ROOT, f)) ? JSON.parse(fs.readFileSync(path.join(ROOT, f))) : {}, ref = {}, opened = readJ('eye.json'), eye = { ...readJ('eye-text.json'), ...opened };
if (fs.existsSync(path.join(ROOT, 'referee.jsonl'))) for (const l of fs.readFileSync(path.join(ROOT, 'referee.jsonl'), 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); if (r.item) ref[r.id] = r.item; }
const items = [], usage = {}, counts = {}, T = {}, right = { plant_typed: 'ocr', decoy_ocr: 'typed', neither: 'neither', wrong_crop: 'cannot_tell' };
for (const t of TAGS) {
  const OUT = path.join(ROOT, 'tags', t), key = JSON.parse(fs.readFileSync(path.join(OUT, 'key.json'))); Object.assign(counts, JSON.parse(fs.readFileSync(path.join(OUT, 'counts.json'))));
  const V = {};
  for (const f of fs.readdirSync(OUT).filter((x) => /^verdicts-.*\.jsonl$/.test(x))) { const r = f.slice(9, -6); V[r] = {}; const u = (usage[r] ||= { packets: 0, items: 0, cost: 0, in: 0, out: 0 }); for (const l of fs.readFileSync(path.join(OUT, f), 'utf8').split('\n').filter(Boolean)) { const row = JSON.parse(l); u.packets++; u.cost += row.cost || 0; u.in += (row.usage?.input_tokens || 0) + (row.usage?.cache_read_input_tokens || 0) + (row.usage?.cache_creation_input_tokens || 0); u.out += row.usage?.output_tokens || 0; for (const it of row.items || []) { V[r][`${row.packet}:${it.n}`] = it; u.items++; } } }
  for (const it of key) { const a = {}; for (const r of Object.keys(V)) a[r] = V[r][`${it.packet}:${it.n}`]; items.push({ ...it, a });
    if (right[it.kind]) for (const r of Object.keys(V)) { if (!a[r]) continue; const c = ((T[r] ||= {})[it.kind] ||= { n: 0, right: 0, ans: {} }), s = said(it, a[r]); c.n++; if (s === right[it.kind]) c.right++; c.ans[s] = (c.ans[s] || 0) + 1; } }
}
const real = items.filter((i) => i.kind === 'real'), agreed = items.filter((i) => i.kind === 'agreed');
for (const it of real) { const v = ref[it.id] || it.a.opus; it.cls = eye[it.id] || classOf(it, v); it.final = v; it.how = eye[it.id] ? 'eye' : ref[it.id] ? 'referee' : 'opus'; if (it.declared_change && it.cls === 'KEYING') { it.cls = 'EDITORIAL_CORR'; it.how += '+declared'; } if ((it.typed || '').includes('〇')) { it.cls = 'GAIJI'; it.how = 'gaiji'; } } // CBETA's own <lem wit=#wit.cbeta>: a change it declares is not a slip of the keyboard
for (const it of agreed) { const v = ref[it.id] || it.a.opus; it.final = v; const seen = [...(v?.seen || '')][0]; it.bothWrong = eye[it.id] ? eye[it.id] === 'BOTH_WRONG' : !!(seen && v.choice !== 'cannot_tell' && foldCh(seen) !== foldCh(it.ocr)); it.unread = !seen || v?.choice === 'cannot_tell'; }
if (LIST) for (const it of real.filter((i) => i.cls === LIST)) console.log(it.id, it.uid, `${it.left}[${it.typed}|${it.ocr}]${it.right}`, it.how, 'op=', said(it, it.a.opus), it.a.opus?.seen, 'ge=', said(it, it.a.gemini), it.a.gemini?.seen, 'ni=', said(it, it.a['opus-noimage']), it.declared_change ? 'DECLARED' : '');
if (LIST === 'AGREED') for (const it of agreed.filter((i) => i.bothWrong)) console.log(it.id, it.uid, `${it.left}[${it.typed}]${it.right}`, 'seen', it.final?.seen);
if (process.argv.includes('--items')) { console.log(JSON.stringify(real.map((i) => ({ id: i.id, uid: i.uid, typed: i.typed, ocr: i.ocr, left: i.left, right: i.right, cls: i.cls, declared_change: i.declared_change })))); process.exit(0); }
const pagesBy = Object.keys(counts), compared = (u) => counts[u].typed_chars - (counts[u].structure_typed ?? counts[u].structure_chars), W = (u) => workOf[u] || u, works = [...new Set(pagesBy.map(W))];
const CL = ['GAIJI', 'KEYING', 'OCR_ERROR', 'OCR_VARIANT', 'EDITORIAL_NORM', 'EDITORIAL_CORR', 'NEITHER', 'CANNOT_TELL', 'STRUCTURE', 'DUP'], n = {}; for (const c of CL) n[c] = real.filter((i) => i.cls === c).length;
const chars = pagesBy.reduce((a, u) => a + compared(u), 0), byWork = {}; for (const w of works) { byWork[w] = { chars: 0 }; for (const c of CL) byWork[w][c] = 0; } for (const u of pagesBy) byWork[W(u)].chars += compared(u); for (const it of real) byWork[W(it.uid)][it.cls]++;
const rng = mulberry(6552), boot = (f) => { const v = []; for (let b = 0; b < 4000; b++) { let x = 0, y = 0; for (let i = 0; i < works.length; i++) { const w = byWork[works[Math.floor(rng() * works.length)]]; x += f(w); y += w.chars; } v.push(1000 * x / Math.max(1, y)); } v.sort((a, b) => a - b); return [v[100], v[3899]].map((x) => +x.toFixed(2)); };
const rate = (name, f) => { const tot = works.reduce((a, w) => a + f(byWork[w]), 0); return { n: tot, per_1000: +(1000 * tot / chars).toFixed(2), ci95: boot(f) }; };
// both-wrong: an agreed span the leaf contradicts. Rule of three on zero.
const ag = agreed.filter((i) => !i.unread), bw = ag.filter((i) => i.bothWrong).length, agChars = chars - real.length, bwRate = ag.length ? bw / ag.length : null, wilsonHi = ag.length ? (() => { const z = 1.96, p = bwRate, m = ag.length; return (p + z * z / (2 * m) + z * Math.sqrt(p * (1 - p) / m + z * z / (4 * m * m))) / (1 + z * z / m); })() : null;
const sub = (s) => agreed.filter((i) => i.stratum === s && !i.unread);
// capture-recapture, witnesses as the two occasions: n1 keying, n2 OCR errors, m wrong at the same position. Chapman, so m=0 is defined.
const n1 = n.KEYING + n.NEITHER, n2 = n.OCR_ERROR + n.NEITHER, mSeen = n.NEITHER, mEst = mSeen + (bwRate ?? 0) * agChars, chap = (a, b, m) => (a + 1) * (b + 1) / (m + 1) - 1;
const out = { collection: arg('c'), pages: pagesBy.length, works: works.length, compared_chars: chars, structure_runs: pagesBy.reduce((a, u) => a + counts[u].structure_long + counts[u].structure_reorder, 0), gaiji: real.filter((i) => i.cls === 'GAIJI').length, real_items: real.length, classes: n,
  keying: rate('k', (w) => w.KEYING), keying_or_neither: rate('kn', (w) => w.KEYING + w.NEITHER), editorial: rate('e', (w) => w.EDITORIAL_NORM + w.EDITORIAL_CORR), ocr_error: rate('o', (w) => w.OCR_ERROR), ocr_variant: rate('v', (w) => w.OCR_VARIANT), cannot_tell: rate('c', (w) => w.CANNOT_TELL),
  declared_cbeta_changes: real.filter((i) => i.declared_change).length, undeclared_corrections: real.filter((i) => i.cls === 'EDITORIAL_CORR' && !i.declared_change && !i.how.includes('declared')).length, keying_zero_upper95_per_1000: +(3000 / chars).toFixed(3), how: real.reduce((a, i) => (a[i.how] = (a[i.how] || 0) + 1, a), {}),
  agreed: { drawn: agreed.length, read: ag.length, both_wrong: bw, near: [sub('near').filter((i) => i.bothWrong).length, sub('near').length], any: [sub('any').filter((i) => i.bothWrong).length, sub('any').length], upper95_per_1000: wilsonHi == null ? null : +(1000 * wilsonHi).toFixed(1), unseen_est_chars: Math.round((bwRate ?? 0) * agChars) },
  capture_recapture: { n1_typed: n1, n2_ocr: n2, m_seen: mSeen, m_with_agreed_est: +mEst.toFixed(1), chapman_positions_seen_m: +chap(n1, n2, mSeen).toFixed(1), chapman_positions_est_m: +chap(n1, n2, mEst).toFixed(1) },
  controls: Object.fromEntries(Object.entries(T).map(([r, t]) => [r, Object.fromEntries(Object.entries(t).map(([k, c]) => [k, { right: c.right, n: c.n, ans: c.ans }]))])), usage };
const pair = (a, b) => { let n2 = 0, same = 0, spl = {}; for (const it of real) { const x = it.a[a], y = it.a[b]; if (!x || !y) continue; n2++; const s = classOf(it, x), t = classOf(it, y); if (s === t) same++; else { const k = `${s}/${t}`; spl[k] = (spl[k] || 0) + 1; } } return { n: n2, same, pct: n2 ? +(100 * same / n2).toFixed(1) : null, splits: spl }; };
// By-eye check of the machine's answer. "machine" is the referee where there was one, else Opus; each reader is judged on what it said alone. DUP counts as KEYING: a displaced character read from either end.
const eyeSame = (a, b) => a === b || (a === 'DUP' && b === 'KEYING') || (a === 'STRUCTURE' && b === 'CANNOT_TELL'), byEye = { opened: 0, machine: 0, opus: 0, gemini: 0, gemini_n: 0, disagreements: {} };
for (const it of real) { const e = opened[it.id]; if (!e) continue; byEye.opened++; const m = classOf(it, it.final); if (eyeSame(e, m)) byEye.machine++; else { const k = `${m}->${e}`; byEye.disagreements[k] = (byEye.disagreements[k] || 0) + 1; } if (eyeSame(e, classOf(it, it.a.opus))) byEye.opus++; if (it.a.gemini) { byEye.gemini_n++; if (eyeSame(e, classOf(it, it.a.gemini))) byEye.gemini++; } } out.by_eye = byEye;
out.agreement_opus_gemini = pair('opus', 'gemini'); out.agreement_opus_noimage = pair('opus', 'opus-noimage');
// What Gemini adds: on items both read, where it split from Opus on a non-variant and the final answer is settled, who was right.
const g = { split: 0, gemini_right: 0, opus_right: 0, neither_right: 0, keying_only_gemini: 0 }; for (const it of real) { const x = it.a.opus, y = it.a.gemini; if (!x || !y) continue; const s = classOf(it, x), t = classOf(it, y); if (s === t || x.variant || y.variant) continue; g.split++; if (t === it.cls) g.gemini_right++; else if (s === it.cls) g.opus_right++; else g.neither_right++; if (t === 'KEYING' && s !== 'KEYING' && it.cls === 'KEYING') g.keying_only_gemini++; } out.gemini_value = g;
// Chao1 over readers: keying findings seen by one reader or both, on items both read.
let f1 = 0, f2 = 0; for (const it of real) { const x = it.a.opus, y = it.a.gemini; if (!x || !y) continue; const s = classOf(it, x) === 'KEYING', t = classOf(it, y) === 'KEYING'; if (s && t) f2++; else if (s || t) f1++; } out.chao_readers = { f1, f2, observed: f1 + f2, chao1: +(f1 + f2 + (f2 ? f1 * f1 / (2 * f2) : f1 * (f1 - 1) / 2)).toFixed(1) };
const j = arg('json'); if (j) fs.writeFileSync(j, JSON.stringify(out, null, 1)); if (!LIST) console.log(JSON.stringify(out, null, 1));
