#!/usr/bin/env node
// PRIOR ART: draw-b.mjs (this directory; one edition, one Paddle read, printed page known in advance). Here three witnesses of one sutra sit at different positions on their own leaves.
// #6552 collection C: T262 as CBETA keyed it; 福智 妙法蓮華經 (book 6a3c61f040c88a541d8f0fc5, hidden, stored Paddle); a 刻本 at Staatsbibliothek Berlin (3 hidden manifests, no OCR).
// CBETA's own leaf is Taisho vol. 9 from archive.org/details/taisho-tripitaka (not in our library; read here only as an arbiter). READ-ONLY on Mongo. ALL TEXT STAYS UNDER $JOB_SCRATCH: 福智 is a hidden modern edition.
//   node --env-file=... draw-c.mjs --stage=fz        20 evenly spaced 福智 pages, fitted to T262, images
//   node draw-c.mjs --stage=old-fetch [--near]       Berlin leaves, to locate only (locate-lines.py over c/old/img next): coarse, then those each passage interpolates to
//   node draw-c.mjs --stage=old-match                the Berlin leaf holding each passage, master image, typed window
//   node draw-c.mjs --stage=taisho                   the Taisho vol. 9 leaves for those passages, via the printed page CBETA gives
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseCbeta } from './cbeta.mjs';
import { foldCh, hanChars, align } from './lib.mjs';
const STAGE = process.argv.find((x) => x.startsWith('--stage='))?.slice(8), C = process.env.JOB_SCRATCH, N = 20, FZ = '6a3c61f040c88a541d8f0fc5';
const OLD = ['3376909687', '3371389189', '3376909660'].map((p) => ({ ppn: p })), dirs = ['c-f', 'c-o', 'c-t'];
for (const d of dirs) for (const s of ['pages', 'img', 'lines']) fs.mkdirSync(path.join(C, d, s), { recursive: true });
fs.mkdirSync(path.join(C, 'c', 'old', 'img'), { recursive: true });
const parsed = parseCbeta(path.join(C, 'b', 'xml', 'T09n0262.xml')), ALL = Object.keys(parsed).sort().flatMap((p) => parsed[p].chars.map((x) => ({ ...x, p }))), FOLDED = ALL.map((x) => foldCh(x.c));
const idx = new Map(); for (let i = 0; i + 3 < FOLDED.length; i++) { const k = FOLDED.slice(i, i + 4).join(''); if (!idx.has(k)) idx.set(k, []); idx.get(k).push(i); }
/** Where a read sits in T262: the modal 4-gram offset, to 40 characters. */
function fit(q) { const v = {}; for (let i = 0; i + 3 < q.length; i++) for (const j of idx.get(q.slice(i, i + 4).join('')) || []) { const b = Math.round((j - i) / 40); v[b] = (v[b] || 0) + 1; } const t = Object.entries(v).sort((a, b) => b[1] - a[1])[0]; return t ? { at: +t[0] * 40, hits: t[1] } : null; }
// The locator reads this woodblock at 15-40%: 3-grams, and every coarse leaf then falls on one straight line (about 128 characters a canvas).
const idx3 = new Map(); for (let i = 0; i + 2 < FOLDED.length; i++) { const k = FOLDED.slice(i, i + 3).join(''); if (!idx3.has(k)) idx3.set(k, []); idx3.get(k).push(i); }
function fit3(q) { const v = {}; for (let i = 0; i + 2 < q.length; i++) for (const j of idx3.get(q.slice(i, i + 3).join('')) || []) { const b = Math.round((j - i) / 40); v[b] = (v[b] || 0) + 1; } const t = Object.entries(v).sort((a, b) => b[1] - a[1])[0]; return t ? { at: +t[0] * 40, hits: t[1] } : null; }
const window = (at, n, pad = 120) => { const a = Math.max(0, at - pad), b = Math.min(ALL.length, at + n + pad), s = ALL.slice(a, b); return { typed: s.map((x) => x.c).join(''), changed_at: s.flatMap((x, i) => x.changed ? [i] : []), a, b }; };
const STATE = path.join(C, 'c', 'passages.json');
/** Berlin leaves whose locator text places them in T262. Locator text is geometry and placement only, never a witness. */
function placed(list) { const L = []; for (const l of list) { const f = path.join(C, 'c', 'old', 'lines', `${l.ppn}-${l.n}.lines.json`); if (!fs.existsSync(f)) continue; const q = JSON.parse(fs.readFileSync(f)).flatMap((r) => hanChars(r.text)).map(foldCh); if (q.length < 30) continue; const t = fit3(q); if (t && t.hits >= 15 && t.hits / q.length > 0.12) L.push({ ...l, han: q.length, at: t.at, hits: t.hits }); } console.log('placed', L.length); return L; }
if (STAGE === 'fz') {
  const { MongoClient } = await import('mongodb'); const { bodyText } = await import('../ground-truth-5935/lib.mjs');
  const c = await MongoClient.connect(process.env.MONGODB_URI, { compressors: ['zlib'] }), pages = c.db('bookstore').collection('pages');
  const cand = JSON.parse(fs.readFileSync(path.join(C, 'c', 'fz.json'))).filter((x) => x.han >= 150 && x.hits / x.han > 0.7).sort((a, b) => a.pn - b.pn), P = [];
  for (let i = 0; i < N; i++) {
    const r = cand[Math.floor((i + 0.5) * cand.length / N)], row = await pages.findOne({ id: r.id }, { projection: { 'ocr.data': 1, photo: 1 } }), text = bodyText(row.ocr.data), q = hanChars(text).map(foldCh), f = fit(q), w = window(f.at, q.length), uid = `F-${r.pn}`;
    const m = align(ALL.slice(w.a, w.b).map((x) => x.c), hanChars(text));
    fs.writeFileSync(path.join(C, 'c-f', 'pages', `${uid}.json`), JSON.stringify({ typed: w.typed, ocr: text, changed_at: w.changed_at }));
    const img = path.join(C, 'c-f', 'img', `${uid}.jpg`); if (!fs.existsSync(img)) { const x = await fetch(row.photo, { redirect: 'follow' }); fs.writeFileSync(img, Buffer.from(await x.arrayBuffer())); }
    P.push({ i, uid, pn: r.pn, page_id: r.id, han: q.length, a: w.a + m.start, b: w.a + m.end, edits: m.edits, tpage0: ALL[w.a + m.start].lb, tpage1: ALL[Math.max(0, w.a + m.end - 1)].lb }); console.log(uid, q.length, P.at(-1).tpage0, P.at(-1).tpage1, m.edits);
  }
  fs.writeFileSync(STATE, JSON.stringify(P)); await c.close();
} else if (STAGE === 'old-fetch') {
  const list = [];
  for (const o of OLD) { const m = await (await fetch(`https://content.staatsbibliothek-berlin.de/dc/PPN${o.ppn}/manifest`)).json(); m.sequences[0].canvases.forEach((v, n) => list.push({ ppn: o.ppn, n, url: v.images[0].resource['@id'] })); }
  fs.writeFileSync(path.join(C, 'c', 'old', 'list.json'), JSON.stringify(list));
  // Berlin answers 429 to anything brisk: one leaf at a time, and only the leaves we need. Coarse pass every 10th canvas, then the canvases each passage interpolates to.
  const near = process.argv.includes('--near'), want = new Set();
  if (!near) list.forEach((l) => { if (l.n % 10 === 5) want.add(`${l.ppn}-${l.n}`); });
  else { const L = placed(list); for (const p of JSON.parse(fs.readFileSync(STATE))) { const mid = (p.a + p.b) / 2; for (const o of OLD) { const q = L.filter((l) => l.ppn === o.ppn).sort((x, y) => x.at - y.at); for (let i = 0; i + 1 < q.length; i++) if (q[i].at <= mid && q[i + 1].at >= mid) { const n = Math.round(q[i].n + (q[i + 1].n - q[i].n) * (mid - q[i].at) / Math.max(1, q[i + 1].at - q[i].at)); for (const d of [-1, 0, 1]) want.add(`${o.ppn}-${n + d}`); } } } }
  for (const l of list) { const id = `${l.ppn}-${l.n}`, f = path.join(C, 'c', 'old', 'img', `${id}.jpg`); if (!want.has(id) || fs.existsSync(f)) continue;
    for (let t = 0; t < 6; t++) { const r = await fetch(l.url); if (r.ok) { fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); break; } console.log(id, r.status); await new Promise((d) => setTimeout(d, 30000)); }
    await new Promise((d) => setTimeout(d, 1500)); }
  console.log('fetched', fs.readdirSync(path.join(C, 'c', 'old', 'img')).length, 'wanted', want.size);
} else if (STAGE === 'old-match') {
  const P = JSON.parse(fs.readFileSync(STATE)), list = JSON.parse(fs.readFileSync(path.join(C, 'c', 'old', 'list.json'))), L = placed(list);
  console.log('leaves placed', L.length, 'of', list.length); const used = new Set();
  for (const p of P) {
    const mid = (p.a + p.b) / 2, best = L.filter((l) => !used.has(`${l.ppn}-${l.n}`) && l.at <= p.b && l.at + l.han >= p.a).sort((x, y) => Math.abs(x.at + x.han / 2 - mid) - Math.abs(y.at + y.han / 2 - mid))[0]; if (!best) { console.log(p.uid, 'no old leaf'); continue; }
    used.add(`${best.ppn}-${best.n}`); const uid = `O-${best.ppn}-${best.n}`, w = window(best.at, best.han), lines = path.join(C, 'c', 'old', 'lines', `${best.ppn}-${best.n}.lines.json`);
    const img = path.join(C, 'c-o', 'img', `${uid}.jpg`); fs.copyFileSync(path.join(C, 'c', 'old', 'img', `${best.ppn}-${best.n}.jpg`), img);
    const sharp = (await import('sharp')).default, m = await sharp(img).metadata(), k = 1;
    fs.writeFileSync(path.join(C, 'c-o', 'lines', `${uid}.lines.json`), JSON.stringify(JSON.parse(fs.readFileSync(lines)).map((x) => ({ ...x, box: x.box.map((v) => Math.round(v * k)) }))));
    fs.writeFileSync(path.join(C, 'c-o', 'pages', `${uid}.json`), JSON.stringify({ typed: w.typed, changed_at: w.changed_at, ocr: '' })); p.old = { uid, ppn: best.ppn, n: best.n, han: best.han, at: best.at, w: m.width, h: m.height }; console.log(p.uid, uid, best.han, best.hits, best.at, m.width);
  }
  fs.writeFileSync(STATE, JSON.stringify(P));
} else if (STAGE === 'taisho') {
  const P = JSON.parse(fs.readFileSync(STATE)), S = '大正高清調整版第009冊共788頁', e = encodeURIComponent(S), need = new Set();
  for (const p of P) { need.add(+p.tpage0.slice(0, 4)); need.add(+p.tpage1.slice(0, 4)); if (p.old) for (const t of [ALL[p.old.at], ALL[Math.min(ALL.length - 1, p.old.at + p.old.han)]]) need.add(+t.lb.slice(0, 4)); }
  for (const pg of need) { // leaf 70 prints page 71 (checked by eye)
    const leaf = String(pg - 1).padStart(4, '0'), uid = `T-${String(pg).padStart(4, '0')}`, jp = path.join(C, 'c', `${uid}.jp2`), img = path.join(C, 'c-t', 'img', `${uid}.jpg`); if (fs.existsSync(img)) continue;
    const r = await fetch(`https://archive.org/download/taisho-tripitaka/${e}_jp2.zip/${e}_jp2/${e}_${leaf}.jp2`, { redirect: 'follow' }); if (!r.ok) { console.log(uid, r.status); continue; } fs.writeFileSync(jp, Buffer.from(await r.arrayBuffer()));
    execFileSync('/root/pz/venv/bin/python', ['-I', '-c', 'import sys;from PIL import Image;Image.open(sys.argv[1]).convert("L").resize((2400,int(2400*Image.open(sys.argv[1]).size[1]/Image.open(sys.argv[1]).size[0]))).save(sys.argv[2],quality=90)', jp, img]); fs.rmSync(jp);
    const pk = String(pg).padStart(4, '0'), self = parsed[pk]?.chars || [], prevp = parsed[String(pg - 1).padStart(4, '0')]?.chars || [], nextp = parsed[String(pg + 1).padStart(4, '0')]?.chars || [], tail = prevp.slice(-60).map((x) => x.c);
    fs.writeFileSync(path.join(C, 'c-t', 'pages', `${uid}.json`), JSON.stringify({ typed: `${tail.join('')}\u0001${self.map((x) => x.c).join('')}\u0001${nextp.slice(0, 60).map((x) => x.c).join('')}`, ocr: '', changed_at: self.flatMap((x, i) => x.changed ? [tail.length + i] : []) })); console.log(uid);
  }
  console.log('leaves', need.size);
}
