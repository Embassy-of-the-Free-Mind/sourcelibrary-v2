#!/usr/bin/env node
// PRIOR ART: scripts/eval/paddle-stale-english-6388/census.mjs (#6518: the lane's stale-page frame, the superseded reading
// from page_revisions, old-vs-new CER = Levenshtein over foldHan(bodyText(·)) / |Paddle|). It runs its census on import,
// so its frame and CER are re-derived here the same way. scripts/lib/paddle-table-detect.mjs (#6516) is the exclusion.
// What is new: a draw stratified by CER bin (8 per bin, one page per book), the old→new character diff as hunks, and a
// snapshot of the production translation prompt for each drawn page.
//
// #6567 gate, step 0. No model call, no write to pages/books. $0.
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/stale-gate-6567/draw.mjs
// Out: draw.json, census.json (committed); $JOB_SCRATCH/pages.json (texts, hunks, prompts), $JOB_SCRATCH/img/<page_id>.jpg.
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { bodyText, foldHan, makeRng } from '../ground-truth-5935/lib.mjs';
import { LANE } from '../../lib/paddle-zh-lane.mjs';
import { paddleTableRisk } from '../../lib/paddle-table-detect.mjs';
import { PAGE_BREAK_SCOPED, buildTranslationPrompt, loadTranslationPrompts } from '../../lib/translate-core.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SCRATCH = process.env.JOB_SCRATCH;
const SEED = 6567, PER_BIN = 8, MIN_HAN = 8;
export const BINS = [[0, 0.05], [0.05, 0.1], [0.1, 0.2], [0.2, 0.5], [0.5, 1.01]];
export const binOf = x => { const b = BINS.find(([lo, hi]) => x >= lo && x < hi); return `${b[0]}–${b[1] > 1 ? 1 : b[1]}`; };

const HAN = /\p{Script=Han}/u;
const fold1 = c => { const f = foldHan(c); return [...f].length === 1 ? f : c; };
const hanChars = t => [...bodyText(t)].filter(c => HAN.test(c));

// Levenshtein alignment over Han characters, compared after folding (so the CER equals #6518's), with a backtrace.
export function align(oldT, newT) {
  const a = hanChars(oldT), b = hanChars(newT);
  const fa = a.map(fold1), fb = b.map(fold1);
  const n = a.length, m = b.length, W = m + 1;
  const d = new Int32Array((n + 1) * W);
  for (let j = 0; j <= m; j++) d[j] = j;
  for (let i = 1; i <= n; i++) {
    d[i * W] = i;
    for (let j = 1; j <= m; j++) d[i * W + j] = Math.min(d[(i - 1) * W + j] + 1, d[i * W + j - 1] + 1, d[(i - 1) * W + j - 1] + (fa[i - 1] === fb[j - 1] ? 0 : 1));
  }
  const ops = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i * W + j] === d[(i - 1) * W + j - 1] + (fa[i - 1] === fb[j - 1] ? 0 : 1)) { ops.push(fa[i - 1] === fb[j - 1] ? ['=', a[i - 1], b[j - 1]] : ['~', a[i - 1], b[j - 1]]); i--; j--; }
    else if (i > 0 && d[i * W + j] === d[(i - 1) * W + j] + 1) { ops.push(['-', a[i - 1], '']); i--; }
    else { ops.push(['+', '', b[j - 1]]); j--; }
  }
  ops.reverse();
  return { dist: d[n * W + m], old_han: n, new_han: m, cer: Math.min(1, d[n * W + m] / Math.max(1, m)), ops };
}

// Change hunks: runs of non-matching ops, merged across a gap of one matching character; each with 4 characters of the
// NEW reading on either side so it can be found in it.
export function hunks(ops, ctx = 4) {
  const out = [];
  let cur = null, gap = 0;
  const newPos = []; let p = 0;
  for (const o of ops) { newPos.push(p); if (o[2]) p++; }
  const newChars = ops.filter(o => o[2]).map(o => o[2]);
  ops.forEach((o, k) => {
    if (o[0] === '=') { if (cur) { gap++; if (gap > 1) { out.push(cur); cur = null; } else cur.pend.push(o); } return; }
    if (!cur) cur = { from: k, old: '', new: '', pend: [], start: newPos[k] };
    for (const g of cur.pend) { cur.old += g[1]; cur.new += g[2]; }
    cur.pend = []; gap = 0;
    cur.old += o[1]; cur.new += o[2]; cur.end = newPos[k] + (o[2] ? 1 : 0);
  });
  if (cur) out.push(cur);
  return out.map((h, i) => ({ id: `h${i + 1}`, old: h.old, new: h.new, before: newChars.slice(Math.max(0, h.start - ctx), h.start).join(''), after: newChars.slice(h.end ?? h.start, (h.end ?? h.start) + ctx).join('') }));
}

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const pages = await db.collection('pages').find(
  { 'translation_stale.reason': 'ocr_rewritten', 'translation_stale.lane': LANE },
  { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, archived_photo: 1, 'ocr.data': 1, 'ocr.source': 1, 'ocr.engine.input.image_url': 1, 'translation.data': 1, 'translation.model': 1 } },
).toArray();
console.log('stale pages (lane)', pages.length);
const revs = new Map();
for (let i = 0; i < pages.length; i += 500) {
  const ids = pages.slice(i, i + 500).map(p => p.id);
  const rows = await db.collection('page_revisions').find({ page_id: { $in: ids }, field: 'ocr', reason: /^reocr_paddle_zh_/ }, { projection: { _id: 0, page_id: 1, data: 1, created_at: 1 } }).toArray();
  for (const r of rows) { const p = revs.get(r.page_id); if (!p || r.created_at > p.created_at) revs.set(r.page_id, r); }
}
const titles = new Map((await db.collection('books').find({ id: { $in: [...new Set(pages.map(p => p.book_id))] } }, { projection: { _id: 0, id: 1, title: 1 } }).toArray()).map(b => [b.id, b.title || '']));

const counts = { stale_pages: pages.length, no_english: 0, not_paddle_now: 0, no_revision: 0, under_min_han: 0, table_detector: 0, eligible: 0 };
const binCounts = Object.fromEntries(BINS.map(([lo]) => [binOf(lo), { all: 0, table_detector: 0, eligible: 0 }]));
const elig = [];
for (const p of pages) {
  const en = String(p.translation?.data || '').trim();
  if (!en || /^\s*\[[^\]]*\]\s*$/.test(en)) { counts.no_english++; continue; }
  if (p.ocr?.source !== 'paddle') { counts.not_paddle_now++; continue; }
  const rev = revs.get(p.id);
  if (!rev) { counts.no_revision++; continue; }
  const o = hanChars(rev.data).map(fold1).join(''), nw = hanChars(p.ocr.data).map(fold1).join('');
  if ([...nw].length < MIN_HAN) { counts.under_min_han++; continue; }
  // CER without the backtrace for the whole frame (fast path); the drawn pages are re-aligned below.
  const cer = Math.min(1, lev(o, nw) / Math.max(1, [...nw].length));
  const bin = binOf(cer);
  binCounts[bin].all++;
  if (paddleTableRisk(p.ocr.data, { title: titles.get(p.book_id) }).flag) { counts.table_detector++; binCounts[bin].table_detector++; continue; }
  counts.eligible++; binCounts[bin].eligible++;
  elig.push({ page_id: p.id, book_id: p.book_id, page_number: p.page_number, cer, bin });
}
function lev(a, b) {
  const x = [...a], y = [...b];
  if (!x.length) return y.length; if (!y.length) return x.length;
  let prev = new Int32Array(y.length + 1), cur = new Int32Array(y.length + 1);
  for (let j = 0; j <= y.length; j++) prev[j] = j;
  for (let i = 1; i <= x.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    [prev, cur] = [cur, prev];
  }
  return prev[y.length];
}

// Draw: bins in order, each bin's eligible pages shuffled by its own seed; take pages whose book is not yet used.
const used = new Set(), pick = [];
BINS.forEach(([lo], bi) => {
  const bin = binOf(lo);
  const xs = elig.filter(r => r.bin === bin).sort((a, b) => a.page_id < b.page_id ? -1 : 1);
  const rng = makeRng(SEED + bi);
  for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [xs[i], xs[j]] = [xs[j], xs[i]]; }
  let k = 0;
  for (const r of xs) { if (k === PER_BIN) break; if (used.has(r.book_id)) continue; used.add(r.book_id); pick.push(r); k++; }
});

const prompts = await loadTranslationPrompts(db);
const full = [];
fs.mkdirSync(path.join(SCRATCH, 'img'), { recursive: true });
for (const r of pick) {
  const p = pages.find(x => x.id === r.page_id);
  const book = await db.collection('books').findOne({ id: p.book_id });
  const near = await db.collection('pages').find({ book_id: p.book_id, page_number: { $in: [p.page_number - 1, p.page_number + 1] } }, { projection: { _id: 0, page_number: 1, 'ocr.data': 1, 'translation.data': 1 } }).toArray();
  const prev = near.find(n => n.page_number === p.page_number - 1), next = near.find(n => n.page_number === p.page_number + 1);
  const built = buildTranslationPrompt({ prompts, book, ocrText: p.ocr.data, previousTranslation: prev?.translation?.data || null, prevOcrText: prev?.ocr?.data || undefined, nextOcrText: next?.ocr?.data || undefined, pageBreak: PAGE_BREAK_SCOPED });
  const old = revs.get(p.id).data;
  const al = align(old, p.ocr.data);
  const image = p.ocr?.engine?.input?.image_url || p.archived_photo; // image-pick-ok: the image the Paddle lane read, as #6518
  const f = path.join(SCRATCH, 'img', `${p.id}.jpg`);
  if (!fs.existsSync(f)) { const res = await fetch(image, { signal: AbortSignal.timeout(60000) }); if (!res.ok) throw new Error(`image ${p.id} ${res.status}`); fs.writeFileSync(f, Buffer.from(await res.arrayBuffer())); }
  full.push({ ...r, title: titles.get(p.book_id), image, cer_aligned: al.cer, old_han: al.old_han, new_han: al.new_han, old, paddle: p.ocr.data, english: p.translation.data, tr_model: p.translation?.model || null, hunks: hunks(al.ops), retranslate_prompt: built.prompt, prompt_ref: built.promptRef });
}
await c.close();
fs.writeFileSync(path.join(SCRATCH, 'pages.json'), JSON.stringify(full, null, 1));
fs.writeFileSync(path.join(HERE, 'census.json'), JSON.stringify({ computed_at: new Date().toISOString(), lane: LANE, counts, bins: binCounts }, null, 1) + '\n');
fs.writeFileSync(path.join(HERE, 'draw.json'), JSON.stringify({ seed: SEED, rule: 'per CER bin (in bin order), eligible pages shuffled by seed 6567+bin index; take the first 8 whose book is not yet drawn. Eligible = stale lane page, English present, Paddle now, lane revision present, >= 8 Han, not flagged by paddleTableRisk', items: full.map(x => ({ page_id: x.page_id, book_id: x.book_id, title: x.title.slice(0, 80), page_number: x.page_number, bin: x.bin, cer: +x.cer.toFixed(4), old_han: x.old_han, new_han: x.new_han, hunks: x.hunks.length, tr_model: x.tr_model, prompt: x.prompt_ref?.name ? `${x.prompt_ref.name} v${x.prompt_ref.version}` : null, image: x.image })) }, null, 1) + '\n');
console.log(JSON.stringify({ counts, binCounts }, null, 1));
console.log('drawn', full.length, full.map(x => `${x.bin}:${x.cer.toFixed(3)}/${x.cer_aligned.toFixed(3)}`).join(' '));
