#!/usr/bin/env node
// PRIOR ART: agy-ocr-per-call-6740/judge.mjs prep (plants controls and seals a judge packet, but whole pages, one output per
// call); lib/contact-sheet.mjs (a sheet of pages, no span crops). Neither crops a character span or mixes blind controls.
// #6552: one tag's items, controls and composite panels. Input: $JOB_SCRATCH/<c>/pages/<uid>.json {typed:string, ocr:string}
// with an image at img/<uid>.jpg and locator rows at lines/<uid>.lines.json. Output stays under $JOB_SCRATCH (all text is private).
//   node prep.mjs --c=a --tag=a1 --uids=u1,u2 --plants=5 --decoys=5 --neither=3 --wrongcrop=3 --agreed=0 --cap=40
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { diffRuns, hanChars, foldCh, nearOf, mulberry, shuffled } from './lib.mjs';
const arg = (n, d) => process.argv.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const C = arg('c'), TAG = arg('tag'), ROOT = path.join(process.env.JOB_SCRATCH, C), rng = mulberry(6552 + [...TAG].reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
const N = { plants: +arg('plants', 5), decoys: +arg('decoys', 5), neither: +arg('neither', 3), wrongcrop: +arg('wrongcrop', 3), agreed: +arg('agreed', 0) };
const CAP = +arg('cap', 40), PANEL = { w: 500, h: 640, per: 6 };
const uids = arg('uids').split(',');
const OUT = path.join(ROOT, 'tags', TAG); fs.mkdirSync(path.join(OUT, 'sheets'), { recursive: true });

const pages = {};
for (const uid of uids) {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'pages', `${uid}.json`), 'utf8'));
  const typed = hanChars(d.typed), ocr = hanChars(d.ocr), r = diffRuns(typed, ocr);
  pages[uid] = { uid, typed, ocr, ...r, lines: JSON.parse(fs.readFileSync(path.join(ROOT, 'lines', `${uid}.lines.json`), 'utf8')) };
}

/** Where a span sits: the locator line and offset best matching its context. Only geometry is kept. */
function locate(pg, left, right) {
  const L = [...left].filter((c) => c !== '□'), R = [...right].filter((c) => c !== '□'); let best = { score: 0 };
  for (const row of pg.lines) {
    const t = hanChars(row.text).map(foldCh);
    for (let p = 0; p <= t.length; p++) {
      let s = 0;
      for (let q = 1; q <= L.length && p - q >= 0; q++) if (t[p - q] === foldCh(L[L.length - q])) s++;
      for (let q = 0; q < R.length && p + q < t.length; q++) if (t[p + q] === foldCh(R[q])) s++;
      if (s > best.score) best = { score: s, row, p, n: t.length };
    }
  }
  return best;
}
async function panel(uid, it) {
  const f = path.join(ROOT, 'img', `${uid}.jpg`), m = await sharp(f).metadata(), loc = locate(pages[uid], it.left, it.right);
  let box, how = 'crop';
  if (loc.score >= 4) {
    const [x0, y0, x1, y1] = loc.row.box, cw = Math.min(x1 - x0, y1 - y0), vertical = (y1 - y0) >= (x1 - x0), frac = (loc.p + 0.5) / Math.max(1, loc.n);
    const cx = vertical ? (x0 + x1) / 2 : x0 + frac * (x1 - x0), cy = vertical ? y0 + frac * (y1 - y0) : (y0 + y1) / 2;
    const hw = Math.max(cw * 1.8, m.width * 0.05), hh = hw * (PANEL.h / PANEL.w);
    box = { left: Math.max(0, Math.round(cx - hw)), top: Math.max(0, Math.round(cy - hh)) };
    box.width = Math.min(m.width - box.left, Math.round(hw * 2)); box.height = Math.min(m.height - box.top, Math.round(hh * 2));
  } else { box = { left: 0, top: 0, width: m.width, height: m.height }; how = 'page'; }
  return { buf: await sharp(f).extract(box).resize(PANEL.w, PANEL.h, { fit: 'contain', background: '#fff' }).png().toBuffer(), how, score: loc.score };
}

const items = []; let seq = 0;
const add = (o) => items.push({ id: `${TAG}-${String(++seq).padStart(4, '0')}`, ...o });
const counts = {};
for (const uid of uids) {
  const pg = pages[uid], judged = pg.diffs.filter((d) => !d.structure);
  counts[uid] = { typed_chars: pg.typedChars, ocr_chars: pg.ocrChars, edits: pg.edits, diffs: pg.diffs.length, judged_pool: judged.length, structure_long: pg.diffs.filter((d) => d.structure === 'long').length, structure_reorder: pg.diffs.filter((d) => d.structure === 'reorder').length, structure_chars: pg.diffs.filter((d) => d.structure).reduce((a, d) => a + d.len, 0) };
  const take = shuffled(judged, rng).slice(0, CAP); counts[uid].judged = take.length;
  for (const d of take) add({ kind: 'real', uid, typed: d.t, ocr: d.o, left: d.left, right: d.right });
}
/** An agreed site with clean context; near = only characters that have a lookalike. */
function site(near) {
  for (let t = 0; t < 4000; t++) {
    const uid = uids[Math.floor(rng() * uids.length)], pg = pages[uid], a = pg.agreed[Math.floor(rng() * pg.agreed.length)];
    if (!a) continue;
    const left = pg.consensus(a.k, -1, 8), right = pg.consensus(a.k, 1, 8), c = pg.ocr[a.j];
    if (left.includes('□') || right.includes('□') || left.length < 6 || right.length < 6) continue;
    if (near && !nearOf(c).length) continue;
    return { uid, c, typedC: pg.typed[a.i], left, right };
  }
  return null;
}
for (let i = 0; i < N.plants; i++) { const s = site(true), w = nearOf(s.c)[0]; add({ kind: 'plant_typed', uid: s.uid, typed: w, ocr: s.c, truth: s.c, left: s.left, right: s.right }); }
for (let i = 0; i < N.decoys; i++) { const s = site(true), w = nearOf(s.c)[0]; add({ kind: 'decoy_ocr', uid: s.uid, typed: s.c, ocr: w, truth: s.c, left: s.left, right: s.right }); }
for (let i = 0; i < N.neither; i++) { let s; do { s = site(true); } while (nearOf(s.c).length < 2); const [w1, w2] = nearOf(s.c); add({ kind: 'neither', uid: s.uid, typed: w1, ocr: w2, truth: s.c, left: s.left, right: s.right }); }
for (let i = 0; i < N.wrongcrop; i++) { const s = site(false), other = uids.filter((u) => u !== s.uid)[Math.floor(rng() * (uids.length - 1))]; const w = nearOf(s.c)[0] || '之'; add({ kind: 'wrong_crop', uid: s.uid, crop_uid: other, typed: w, ocr: s.c, left: s.left, right: s.right }); }
for (let i = 0; i < N.agreed; i++) { const s = site(i % 2 === 0); add({ kind: 'agreed', stratum: i % 2 === 0 ? 'near' : 'any', uid: s.uid, typed: s.typedC, ocr: s.c, left: s.left, right: s.right }); }

// Blind: order of the two readings is random, the kind and witness never reach a reader. Controls are dealt in with the real ones.
const dealt = shuffled(items, rng); const packets = [];
for (let i = 0; i < dealt.length; i += PANEL.per) packets.push(dealt.slice(i, i + PANEL.per));
const key = [], packs = [];
for (const [pi, pk] of packets.entries()) {
  const comps = [], lines = [];
  for (const [n, it] of pk.entries()) {
    const swap = rng() < 0.5, A = swap ? it.ocr : it.typed, B = swap ? it.typed : it.ocr;
    const src = it.kind === 'wrong_crop' ? it.crop_uid : it.uid;
    const ctx = it.kind === 'wrong_crop' ? await panel(src, (() => { const s = pages[src]; const a = s.agreed[Math.floor(rng() * s.agreed.length)]; return { left: s.consensus(a.k, -1, 8), right: s.consensus(a.k, 1, 8) }; })()) : await panel(src, it);
    const col = n % 3, row = Math.floor(n / 3), left = col * (PANEL.w + 10), top = row * (PANEL.h + 10);
    comps.push({ input: ctx.buf, left, top }, { input: Buffer.from(`<svg width="64" height="44"><rect width="64" height="44" fill="#c00"/><text x="32" y="33" font-size="30" fill="#fff" text-anchor="middle" font-family="DejaVu Sans">${n + 1}</text></svg>`), left: left, top });
    lines.push(it.kind === 'agreed' ? `[${n + 1}] context: ${it.left}[?]${it.right} | no candidate readings: say what the leaf shows at [?]` : `[${n + 1}] context: ${it.left}[?]${it.right} | Reading A: ${A || '(nothing)'} | Reading B: ${B || '(nothing)'}`);
    key.push({ ...it, packet: pi, n: n + 1, swap, crop: ctx.how, loc_score: ctx.score });
  }
  const file = `p${String(pi).padStart(3, '0')}.png`;
  await sharp({ create: { width: 3 * PANEL.w + 20, height: 2 * PANEL.h + 10, channels: 3, background: '#888' } }).composite(comps).png().toFile(path.join(OUT, 'sheets', file));
  packs.push({ packet: pi, file, n: pk.length, text: lines.join('\n') });
}
fs.writeFileSync(path.join(OUT, 'key.json'), JSON.stringify(key));
fs.writeFileSync(path.join(OUT, 'packets.json'), JSON.stringify(packs));
fs.writeFileSync(path.join(OUT, 'counts.json'), JSON.stringify(counts, null, 1));
const k = {}; for (const i of items) k[i.kind] = (k[i.kind] || 0) + 1;
const crop = {}; for (const i of key) crop[i.crop] = (crop[i.crop] || 0) + 1;
console.log(TAG, k, 'packets', packs.length, 'crop', crop); console.table(Object.fromEntries(Object.entries(counts).map(([u, v]) => [u, v])));
